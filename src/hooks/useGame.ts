"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

/* ========= shared types ========= */
type Side = "p1" | "p2";
type DicePool = Record<string, number>;
type UnitVM = { code: string; attack: number; hp: number; element: string };

type ClientState =
  | {
      mode: "lobby";
      ready: { p1: boolean; p2: boolean };
      rngSeed?: string;
      lastAction?: unknown;
    }
  | {
      mode: "play";
      turn: Side;
      phaseNo: number;
      hero: Record<Side, number>;
      dice: Record<Side, DicePool>;
      board: Record<Side, UnitVM[]>;
      hand: Record<Side, string[]>;
      lastAction?: unknown;
    };

type PlayerInfo = { userId: string; name?: string | null; avatar?: string | null } | null;
type ServerPlayers = { p1: PlayerInfo; p2: PlayerInfo };

type ServerStateLobby = {
  phase: "lobby";
  ready?: { p1: boolean; p2: boolean };
  rngSeed?: string;
  lastAction?: unknown;
};

type ServerStatePlay = {
  phase: "play";
  turn: Side;
  phaseNo?: number;
  hero?: Record<Side, number>;
  dice?: Record<Side, DicePool>;
  board?: Record<Side, UnitVM[]>;
  hand?: Record<Side, string[]>;
  lastAction?: unknown;
};

type ServerState = ServerStateLobby | ServerStatePlay;

type ApiStateResponse = {
  ok: boolean;
  state?: ServerState;
  players?: ServerPlayers;
};

function stableGuestId(): string {
  const key = "NOF_guestId";
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/** ดึง user (id/name/avatar) จาก next-auth; ถ้าไม่มี ใช้ guest */
function useStableUser() {
  const { data: session } = useSession();
  return useMemo(() => {
    const userId =
      (session?.user as { id?: string | null } | undefined)?.id ??
      session?.user?.email ??
      stableGuestId();
    const name = session?.user?.name ?? null;
    const avatar = (session?.user as { image?: string | null } | undefined)?.image ?? null;
    return { userId: String(userId), name, avatar };
  }, [session?.user]);
}

/** POST กันแฮง + จับ error นิ่ม ๆ */
async function post<T>(
  body: unknown,
  { timeoutMs = 8000 }: { timeoutMs?: number } = {}
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("/api/game", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const text = await res.text().catch(() => "");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (!res.ok) {
      const msg =
        (json as { error?: string } | null)?.error ??
        (text || `${res.status} ${res.statusText}`);
      throw new Error(msg);
    }
    return json as T;
  } finally {
    clearTimeout(t);
  }
}

/* ========= hook ========= */
type UseGameReturn = {
  you: Side | null;
  players: ServerPlayers;
  state: ClientState | null;

  ready: () => Promise<void>;
  endTurn: () => Promise<void>;
  endPhase: () => Promise<void>;
  playCard: (index: number) => Promise<void>;
  attackActive: (index?: number) => Promise<void>;
};

export function useGame(roomId: string): UseGameReturn {
  const me = useStableUser();

  const [players, setPlayers] = useState<ServerPlayers>({ p1: null, p2: null });
  const [state, setState] = useState<ClientState | null>(null);

  const pollTimer = useRef<number | null>(null);
  const pullLock = useRef(false);
  const joinLock = useRef(false);
  const actionLock = useRef(false);
  const youSticky = useRef<Side | null>(null);
  const lastPullFailAt = useRef<number>(0);

  const parseServerState = useCallback((s?: ServerState) => {
    if (!s) return;
    if (s.phase === "lobby") {
      setState({
        mode: "lobby",
        ready: s.ready ?? { p1: false, p2: false },
        rngSeed: s.rngSeed,
        lastAction: s.lastAction,
      });
    } else if (s.phase === "play") {
      setState({
        mode: "play",
        turn: s.turn,
        phaseNo: s.phaseNo ?? 1,
        hero: s.hero ?? { p1: 30, p2: 30 },
        dice: s.dice ?? { p1: {}, p2: {} },
        board: s.board ?? { p1: [], p2: [] },
        hand: s.hand ?? { p1: [], p2: [] },
        lastAction: s.lastAction,
      });
    }
  }, []);

  const pull = useCallback(async () => {
    if (pullLock.current) return;
    pullLock.current = true;
    try {
      const res = await post<ApiStateResponse>({ action: "state", roomId });
      if (res.players) setPlayers(res.players);
      parseServerState(res.state);
      lastPullFailAt.current = 0;
    } catch {
      lastPullFailAt.current = Date.now();
    } finally {
      pullLock.current = false;
    }
  }, [roomId, parseServerState]);

  // auto-poll + backoff เล็กน้อย
  useEffect(() => {
    const tick = async () => {
      await pull();
      const base = document.visibilityState === "visible" ? 1600 : 2400;
      const backoff =
        lastPullFailAt.current && Date.now() - lastPullFailAt.current < 5000
          ? 1200
          : 0;
      pollTimer.current = window.setTimeout(tick, base + backoff);
    };
    tick();
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    };
  }, [pull]);

  // หา you และจำไว้กันหายตอน pull ช้า
  const computedYou: Side | null = useMemo(() => {
    if (players.p1?.userId === me.userId) return "p1";
    if (players.p2?.userId === me.userId) return "p2";
    return null;
  }, [players, me.userId]);

  useEffect(() => {
    if (computedYou) youSticky.current = computedYou;
  }, [computedYou]);

  const you: Side | null = computedYou ?? youSticky.current ?? null;

  // auto-join: ถ้ายังไม่มีที่นั่งเรา → joinRoom
  const join = useCallback(async () => {
    if (joinLock.current) return;
    joinLock.current = true;
    try {
      await post<{ ok: boolean }>({
        action: "joinRoom",
        roomId,
        user: {
          userId: me.userId,
          name: me.name ?? null,
          avatar: me.avatar ?? null,
        },
      });
    } catch {
      // เงียบไว้
    } finally {
      joinLock.current = false;
      await pull();
    }
  }, [roomId, me.userId, me.name, me.avatar, pull]);

  // พยายาม join อัตโนมัติเมื่อมีที่ว่าง
  useEffect(() => {
    const weAreIn =
      players.p1?.userId === me.userId || players.p2?.userId === me.userId;
    const seatAvailable = !players.p1 || !players.p2;
    if (!weAreIn && seatAvailable) void join();
  }, [players, me.userId, join]);

  // ensureSide: ถ้ายังไม่มีที่นั่ง จะพยายาม join 1 รอบ แล้วเลิกเงียบ ๆ
  const ensureSide = useCallback(async (): Promise<Side | null> => {
    if (you === "p1" || you === "p2") return you;
    await join();
    const latest =
      players.p1?.userId === me.userId
        ? "p1"
        : players.p2?.userId === me.userId
        ? "p2"
        : null;
    return latest ?? null;
  }, [you, join, players, me.userId]);

  // ตัวห่อกันยิงซ้อนทุก action
  const withActionLock = useCallback(
    async (fn: () => Promise<void>) => {
      if (actionLock.current) return;
      actionLock.current = true;
      try {
        await fn();
      } catch {
        // เงียบ ๆ
      } finally {
        actionLock.current = false;
        await pull();
      }
    },
    [pull]
  );

  const ready = useCallback(async () => {
    await withActionLock(async () => {
      const side = await ensureSide();
      if (!side) return;
      try {
        await post<void>({ action: "ready", roomId, side, userId: me.userId });
      } catch {
        /* no-op */
      }
    });
  }, [ensureSide, roomId, me.userId, withActionLock]);

  const endTurn = useCallback(async () => {
    await withActionLock(async () => {
      const side = await ensureSide();
      if (!side) return;
      try {
        await post<void>({
          action: "action",
          roomId,
          side,
          payload: { kind: "endTurn" },
        });
      } catch {
        /* no-op */
      }
    });
  }, [ensureSide, roomId, withActionLock]);

  const endPhase = useCallback(async () => {
    await withActionLock(async () => {
      const side = await ensureSide();
      if (!side) return;
      try {
        await post<void>({
          action: "action",
          roomId,
          side,
          payload: { kind: "endPhase" },
        });
      } catch {
        /* no-op */
      }
    });
  }, [ensureSide, roomId, withActionLock]);

  const playCard = useCallback(
    async (index: number) => {
      await withActionLock(async () => {
        const side = await ensureSide();
        if (!side) return;
        try {
          await post<void>({
            action: "action",
            roomId,
            side,
            payload: { kind: "playCard", index },
          });
        } catch {
          /* no-op */
        }
      });
    },
    [ensureSide, roomId, withActionLock]
  );

  const attackActive = useCallback(
    async (index = 0) => {
      await withActionLock(async () => {
        const side = await ensureSide();
        if (!side) return;
        try {
          await post<void>({
            action: "action",
            roomId,
            side,
            payload: { kind: "attack", index },
          });
        } catch {
          /* no-op */
        }
      });
    },
    [ensureSide, roomId, withActionLock]
  );

  return { you, players, state, ready, endTurn, endPhase, playCard, attackActive };
}
