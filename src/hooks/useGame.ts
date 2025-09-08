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

type ApiStateResponse = { ok: boolean; state?: ServerState; players?: ServerPlayers };

function stableGuestId(): string {
  const key = "NOF_guestId";
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
function useStableUser() {
  const { data: session } = useSession();
  const userId =
    (session?.user as { id?: string | null } | undefined)?.id ??
    session?.user?.email ??
    stableGuestId();
  return useMemo(() => ({
    userId: String(userId),
    name: session?.user?.name ?? "Player",
    avatar: session?.user?.image ?? null,
  }), [userId, session?.user?.name, session?.user?.image]);
}

/** call /api/game แบบปลอดภัย */
async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  if (!res.ok) {
    const msg = (json && json.error) ? json.error : (text || res.statusText);
    throw new Error(msg);
  }
  return (json as T) ?? ({} as T);
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
  const user = useStableUser();

  const [players, setPlayers] = useState<ServerPlayers>({ p1: null, p2: null });
  const [state, setState] = useState<ClientState | null>(null);

  const timer = useRef<number | null>(null);
  const youSticky = useRef<Side | null>(null);

  const pull = useCallback(async () => {
    try {
      const res = await post<ApiStateResponse>({ action: "state", roomId });
      if (res.players) setPlayers(res.players);

      const s = res.state;
      if (s?.phase === "lobby") {
        setState({
          mode: "lobby",
          ready: s.ready ?? { p1: false, p2: false },
          rngSeed: (s as ServerStateLobby).rngSeed,
          lastAction: s.lastAction,
        });
      } else if (s?.phase === "play") {
        setState({
          mode: "play",
          turn: (s as ServerStatePlay).turn,
          phaseNo: s.phaseNo ?? 1,
          hero: s.hero ?? { p1: 30, p2: 30 },
          dice: s.dice ?? { p1: {}, p2: {} },
          board: s.board ?? { p1: [], p2: [] },
          hand: s.hand ?? { p1: [], p2: [] },
          lastAction: s.lastAction,
        });
      }
    } catch { /* เงียบ ๆ */ }
  }, [roomId]);

  useEffect(() => {
    pull();
    timer.current = window.setInterval(pull, 1200);
    return () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; };
  }, [pull]);

  const computedYou: Side | null = useMemo(() => {
    if (players.p1?.userId === user.userId) return "p1";
    if (players.p2?.userId === user.userId) return "p2";
    return null;
  }, [players, user.userId]);

  useEffect(() => { if (computedYou) youSticky.current = computedYou; }, [computedYou]);
  const you: Side | null = computedYou ?? youSticky.current ?? null;

  // claim seat อัตโนมัติ (ส่ง user object)
  const join = useCallback(async () => {
    try {
      await post<{ ok: boolean }>({
        action: "joinRoom",
        roomId,
        user, // <<< สำคัญสุด ๆ
      });
    } finally {
      await pull();
    }
  }, [roomId, user, pull]);

  useEffect(() => {
    const inSeat = players.p1?.userId === user.userId || players.p2?.userId === user.userId;
    const hasSlot = !players.p1 || !players.p2;
    if (!inSeat && hasSlot) void join();
  }, [players, user.userId, join]);

  const ensureSide = useCallback(async (): Promise<Side> => {
    if (you === "p1" || you === "p2") return you;
    await join();
    const latest: Side | null =
      players.p1?.userId === user.userId ? "p1" :
      players.p2?.userId === user.userId ? "p2" : null;
    if (latest) return latest;
    throw new Error("Seat not assigned yet");
  }, [you, join, players.p1?.userId, players.p2?.userId, user.userId]);

  const ready = useCallback(async () => {
    const side = await ensureSide();
    await post<void>({ action: "ready", roomId, side, userId: user.userId });
    await pull();
  }, [ensureSide, pull, roomId, user.userId]);

  const endTurn = useCallback(async () => {
    const side = await ensureSide();
    await post<void>({ action: "action", roomId, side, payload: { kind: "endTurn" } });
    await pull();
  }, [ensureSide, pull, roomId]);

  const endPhase = useCallback(async () => {
    const side = await ensureSide();
    await post<void>({ action: "action", roomId, side, payload: { kind: "endPhase" } });
    await pull();
  }, [ensureSide, pull, roomId]);

  const playCard = useCallback(async (index: number) => {
    const side = await ensureSide();
    await post<void>({ action: "action", roomId, side, payload: { kind: "playCard", index } });
    await pull();
  }, [ensureSide, pull, roomId]);

  const attackActive = useCallback(async (index = 0) => {
    const side = await ensureSide();
    await post<void>({ action: "action", roomId, side, payload: { kind: "attack", index } });
    await pull();
  }, [ensureSide, pull, roomId]);

  return { you, players, state, ready, endTurn, endPhase, playCard, attackActive };
}
