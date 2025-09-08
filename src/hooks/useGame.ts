"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

/* ========= shared types (ให้สั้นและไม่ผูกกับฝั่ง server มากเกินไป) ========= */
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

/* ========= utils ========= */

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

/** userId เสถียร: ถ้ามี next-auth ใช้อันนั้น ไม่งั้นใช้ guestId */
function useStableUserId(): string {
  const { data: session } = useSession();
  return useMemo(() => {
    const fromAuth =
      (session?.user as { id?: string | null } | undefined)?.id ??
      session?.user?.email ??
      null;
    return fromAuth ? String(fromAuth) : stableGuestId();
  }, [session?.user]);
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText);
  }
  return res.json() as Promise<T>;
}

/* ========= hook หลัก ========= */

type UseGameReturn = {
  you: Side | null; // ที่นั่งของเรา (ถ้าแมตช์ userId ไม่ได้จะเป็น null)
  players: { p1: PlayerInfo; p2: PlayerInfo };
  state: ClientState | null;

  // actions
  ready: () => Promise<void>;
  endTurn: () => Promise<void>;
  endPhase: () => Promise<void>;
  playCard: (index: number) => Promise<void>;
  attackActive: (index?: number) => Promise<void>;
};

export function useGame(roomId: string): UseGameReturn {
  const userId = useStableUserId();

  const [players, setPlayers] = useState<{ p1: PlayerInfo; p2: PlayerInfo }>({
    p1: null,
    p2: null,
  });
  const [state, setState] = useState<ClientState | null>(null);

  const timer = useRef<number | null>(null);

  // polling เฉพาะ state / players — ไม่ auto-join
  const pull = useCallback(async () => {
    try {
      const res = await post<{
        ok: boolean;
        state?: any;
        players?: { p1: PlayerInfo; p2: PlayerInfo };
      }>({ action: "state", roomId });
      if (res?.players) setPlayers(res.players);
      if (res?.state) {
        // map ให้เป็น ClientState แบบ client
        const s = res.state as any;
        if (s?.phase === "lobby") {
          setState({
            mode: "lobby",
            ready: s.ready ?? { p1: false, p2: false },
            rngSeed: s.rngSeed,
            lastAction: s.lastAction,
          });
        } else if (s?.phase === "play") {
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
      }
    } catch {
      // เงียบ ๆ ไปก่อน
    }
  }, [roomId]);

  useEffect(() => {
    pull(); // ดึงทันที
    timer.current = window.setInterval(pull, 1200);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [pull]);

  // ระบุ "you" จากการแมตช์ userId ของเราเข้ากับ players
  const you: Side | null = useMemo(() => {
    if (players.p1?.userId === userId) return "p1";
    if (players.p2?.userId === userId) return "p2";
    return null;
  }, [players, userId]);

  /* ===== actions ===== */

  const ensureSide = useCallback((): Side => {
    if (you === "p1" || you === "p2") return you;
    // ถ้าแมตช์ไม่ได้ ให้เดาว่า p1 (ใช้กับ lobby/ready)
    return "p1";
  }, [you]);

  const ready = useCallback(async () => {
    const side = ensureSide();
    await post({ action: "ready", roomId, side });
    await pull();
  }, [ensureSide, pull, roomId]);

  const endTurn = useCallback(async () => {
    const side = ensureSide();
    await post({ action: "action", roomId, side, payload: { kind: "endTurn" } });
    await pull();
  }, [ensureSide, pull, roomId]);

  const endPhase = useCallback(async () => {
    const side = ensureSide();
    await post({ action: "action", roomId, side, payload: { kind: "endPhase" } });
    await pull();
  }, [ensureSide, pull, roomId]);

  const playCard = useCallback(
    async (index: number) => {
      const side = ensureSide();
      await post({
        action: "action",
        roomId,
        side,
        payload: { kind: "playCard", index },
      });
      await pull();
    },
    [ensureSide, pull, roomId]
  );

  const attackActive = useCallback(
    async (index = 0) => {
      const side = ensureSide();
      await post({
        action: "action",
        roomId,
        side,
        payload: { kind: "attack", index },
      });
      await pull();
    },
    [ensureSide, pull, roomId]
  );

  return { you, players, state, ready, endTurn, endPhase, playCard, attackActive };
}
