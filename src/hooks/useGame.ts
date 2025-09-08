"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ===== shared types (ซิงค์กับฝั่ง server) ===== */
export type Side = "p1" | "p2";
export type Element =
  | "Pyro" | "Hydro" | "Cryo" | "Electro"
  | "Geo" | "Anemo" | "Quantum" | "Imaginary" | "Neutral";

export type DicePool = Record<Element, number>;
export type UnitVM = { code: string; attack: number; hp: number; element: string };

export type ClientState = {
  mode?: "lobby" | "play";
  turn: Side;
  phaseNo?: number;
  hero: Record<Side, number>;
  dice: Record<Side, DicePool>;
  board: Record<Side, UnitVM[]>;
  hand: Record<Side, string[]>;
  ready?: { p1: boolean; p2: boolean };
};

export type PlayerInfo = { userId: string; name?: string | null; avatar?: string | null };
export type PlayersVM = {
  p1: PlayerInfo | null;
  p2: PlayerInfo | null;
};

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

type JoinRes = ApiOk<{ roomId: string; you: Side; players: PlayersVM; state: unknown }>;
type StateRes = ApiOk<{ state: unknown; players: PlayersVM }>;

function isBattleState(s: unknown): s is ClientState {
  // รับกึ่ง ๆ พอใช้ render — ไม่ต้อง strict เกิน
  if (!s || typeof s !== "object") return false;
  const st = s as Record<string, unknown>;
  return "turn" in st && "hero" in st && "dice" in st && "board" in st && "hand" in st;
}

export function useGame(roomId: string) {
  const [you, setYou] = useState<Side | null>(null);
  const [players, setPlayers] = useState<PlayersVM>({ p1: null, p2: null });
  const [state, setState] = useState<ClientState | null>(null);

  const roomRef = useRef(roomId);
  roomRef.current = roomId;

  // join room ทันที
  useEffect(() => {
    let aborted = false;

    async function join() {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "joinRoom", roomId, user: { userId: "local", name: "You" } }),
      });

      const data: JoinRes | ApiErr = await res.json();
      if (aborted) return;

      if ("ok" in data && data.ok) {
        setYou(data.you);
        setPlayers(data.players);
        if (isBattleState(data.state)) {
          setState(data.state);
        } else {
          // แปลงเป็น ClientState โหมด lobby ให้พอ render
          setState({
            mode: "lobby",
            turn: "p1",
            phaseNo: 1,
            hero: { p1: 30, p2: 30 },
            dice: { p1: {} as DicePool, p2: {} as DicePool },
            board: { p1: [], p2: [] },
            hand: { p1: [], p2: [] },
            ready: { p1: false, p2: false },
          });
        }
      }
    }

    join().catch(() => undefined);
    return () => { aborted = true; };
  }, [roomId]);

  // pull state ช่วง ๆ (simple polling)
  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/game", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "state", roomId: roomRef.current }),
        });
        const data: StateRes | ApiErr = await res.json();
        if (!stopped && "ok" in data && data.ok && isBattleState(data.state)) {
          setState(data.state);
          setPlayers(data.players);
        }
      } catch {
        // เงียบ ๆ
      } finally {
        if (!stopped) {
          timer = window.setTimeout(tick, 1000);
        }
      }
    };

    timer = window.setTimeout(tick, 300);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  /* ===== action helpers ===== */
  const call = useCallback(async (payload: unknown) => {
    if (!you) return null;
    const res = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "action", roomId: roomRef.current, side: you, payload }),
    });
    type ActionRes = ApiOk<{ patch: unknown; winner: Side | null }> | ApiErr;
    const data: ActionRes = await res.json();
    return data;
  }, [you]);

  const ready = useCallback(async () => {
    await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ready", roomId: roomRef.current, userId: "local" }),
    });
  }, []);

  const endTurn = useCallback(() => call({ kind: "endTurn" }), [call]);
  const endPhase = useCallback(() => call({ kind: "endPhase" }), [call]);
  const playCard = useCallback((index: number) => call({ kind: "playCard", index }), [call]);
  const attackActive = useCallback((index = 0) => call({ kind: "attack", index }), [call]);

  return { you, players, state, ready, endTurn, endPhase, playCard, attackActive };
}
