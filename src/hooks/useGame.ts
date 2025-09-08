"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ============= Types (ขั้นต่ำที่ใช้จริง) ============= */
export type Side = "p1" | "p2";
type DicePool = Record<string, number>;

export type PlayerInfo = {
  userId: string;
  name?: string | null;
  avatar?: string | null;
};

export type UnitVM = { code: string; attack: number; hp: number; element: string };

export type ClientState =
  | null
  | {
      mode?: "lobby" | "play";
      turn: Side;
      phaseNo?: number;
      hero: Record<Side, number>;
      dice: Record<Side, DicePool>;
      board: Record<Side, UnitVM[]>;
      hand: Record<Side, string[]>;
      ready?: { p1: boolean; p2: boolean };
    };

export type PlayersVM = {
  p1: { userId: string; name?: string | null; avatar?: string | null } | null;
  p2: { userId: string; name?: string | null; avatar?: string | null } | null;
};

/* ============= helpers ============= */

async function postJSON<TResp>(body: unknown): Promise<TResp> {
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
  return (await res.json()) as TResp;
}

/** สร้าง guest id ที่เสถียร เพื่อระบุตัวผู้เล่นฝั่ง client */
function stableUserId(): string {
  if (typeof window === "undefined") return "ssr";
  const key = "NOF_guestId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/* ============= Hook ============= */
export function useGame(roomId: string) {
  // state หลักที่เพจใช้
  const [state, setState] = useState<ClientState>(null);
  const [players, setPlayers] = useState<PlayersVM>({ p1: null, p2: null });
  const [you, setYou] = useState<Side | "-">("-");

  // เก็บ you แบบ ref เพื่อกันการเขียนทับโดยโพลล์
  const youRef = useRef<Side | "-">("-");
  const roomRef = useRef(roomId);
  roomRef.current = roomId;

  // ตั้งค่า you “ครั้งเดียวจากคำสั่งสร้าง/เข้าห้อง” เท่านั้น
  const setYouOnce = useCallback((side: Side) => {
    youRef.current = side;
    setYou(side);
  }, []);

  // ------------- โพลล์สถานะ -------------
  useEffect(() => {
    let stop = false;

    async function tick() {
      try {
        const res = await postJSON<{
          ok: boolean;
          state?: unknown;
          players?: PlayersVM;
          you?: Side | "-";
        }>({ action: "state", roomId: roomRef.current });

        // อัปเดต you เฉพาะกรณี server ส่งมาเป็น p1/p2 เท่านั้น
        if (res.you === "p1" || res.you === "p2") {
          youRef.current = res.you;
          setYou(res.you);
        }

        if (res.players) setPlayers(res.players);

        // อัปเดต state แบบ type-safe
        setState((prev: ClientState) => {
          // ถ้า server ส่ง state มาให้ทั้งก้อน ก็ใช้เลย
          if (typeof res.state === "object" && res.state !== null) {
            return res.state as ClientState;
          }
          // ไม่งั้นคงค่าเดิม (กันจอดำ)
          return prev;
        });
      } finally {
        if (!stop) setTimeout(tick, 1000);
      }
    }

    tick();
    return () => {
      stop = true;
    };
  }, []);

  // ------------- คำสั่งฝั่งผู้เล่น -------------
  const ready = useCallback(async () => {
    const user: PlayerInfo = {
      userId: stableUserId(),
      name: undefined,
      avatar: undefined,
    };
    // เรียก ready กับ side ปัจจุบัน (ถ้าไม่รู้ ให้ server ระบุจาก userId)
    const res = await postJSON<{
      ok: boolean;
      full?: boolean;
      state?: unknown;
      patch?: unknown;
    }>({
      action: "ready",
      roomId,
      userId: user.userId,
    });

    // ป้องกันจอดำ: ถ้า server ส่ง state ใหม่มา ใช้แทนทันที
    setState((prev: ClientState) => {
      if (typeof res.state === "object" && res.state !== null) {
        return res.state as ClientState;
      }
      return prev;
    });
  }, [roomId]);

  const endTurn = useCallback(async () => {
    const res = await postJSON<{ ok: boolean; patch?: unknown }>({
      action: "action",
      roomId,
      side: (youRef.current === "p1" || youRef.current === "p2" ? youRef.current : "p1") as Side,
      payload: { kind: "endTurn" },
    });
    setState((prev: ClientState) => {
      if (typeof res.patch === "object" && res.patch !== null && typeof prev === "object" && prev) {
        return { ...(prev as Record<string, unknown>), ...(res.patch as Record<string, unknown>) } as ClientState;
      }
      return prev;
    });
  }, [roomId]);

  const endPhase = useCallback(async () => {
    const res = await postJSON<{ ok: boolean; patch?: unknown }>({
      action: "action",
      roomId,
      side: (youRef.current === "p1" || youRef.current === "p2" ? youRef.current : "p1") as Side,
      payload: { kind: "endPhase" },
    });
    setState((prev: ClientState) => {
      if (typeof res.patch === "object" && res.patch !== null && typeof prev === "object" && prev) {
        return { ...(prev as Record<string, unknown>), ...(res.patch as Record<string, unknown>) } as ClientState;
      }
      return prev;
    });
  }, [roomId]);

  const playCard = useCallback(
    async (index: number) => {
      const res = await postJSON<{ ok: boolean; patch?: unknown }>({
        action: "action",
        roomId,
        side: (youRef.current === "p1" || youRef.current === "p2" ? youRef.current : "p1") as Side,
        payload: { kind: "playCard", index },
      });
      setState((prev: ClientState) => {
        if (typeof res.patch === "object" && res.patch !== null && typeof prev === "object" && prev) {
          return { ...(prev as Record<string, unknown>), ...(res.patch as Record<string, unknown>) } as ClientState;
        }
        return prev;
      });
    },
    [roomId]
  );

  const attackActive = useCallback(async () => {
    const res = await postJSON<{ ok: boolean; patch?: unknown }>({
      action: "action",
      roomId,
      side: (youRef.current === "p1" || youRef.current === "p2" ? youRef.current : "p1") as Side,
      payload: { kind: "attack", index: 0 },
    });
    setState((prev: ClientState) => {
      if (typeof res.patch === "object" && res.patch !== null && typeof prev === "object" && prev) {
        return { ...(prev as Record<string, unknown>), ...(res.patch as Record<string, unknown>) } as ClientState;
      }
      return prev;
    });
  }, [roomId]);

  return {
    you,
    players,
    state,
    ready,
    endTurn,
    endPhase,
    playCard,
    attackActive,
    // util เผื่อเพจอยากใช้
    setYouOnce,
  };
}
