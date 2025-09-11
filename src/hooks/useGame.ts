// src/hooks/useGame.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type Side = "p1" | "p2";
export type DicePool = Record<string, number>;
export type UnitVM = { code: string; element: string; attack: number; hp: number; gauge?: number };
export type PlayerInfo = { userId: string; name?: string | null; avatar?: string | null };

export type ClientState = {
  mode: "lobby" | "play";
  players: Partial<Record<Side, { name: string; avatar: string | null }>>;
  coin: { decided: boolean; winner?: Side };
  coinAck: Record<Side, boolean>;
  turn: Side;
  phaseNo: number;
  phaseActor: Side;
  endTurned: Record<Side, boolean>;
  hero: Record<Side, number>;
  dice: Record<Side, DicePool>;
  board: Record<Side, UnitVM[]>;
  hand: Record<Side, string[]>;
  ready: Record<Side, boolean>;
  you?: Side;
  warnNoDeck?: string[];
};

type ApiOk<T extends Record<string, unknown> = Record<string, never>> = { ok: true } & T;
type ApiErr = { error: string };

// ---------- เพิ่ม seat ลงใน payload ----------
type ApiPayload = {
  action: string;
  roomId?: string;
  userId?: string;
  user?: PlayerInfo;
  index?: number;
  attacker?: number;
  target?: number | null;
  mode?: "basic" | "skill" | "ult";
  seat?: Side; // <- เพิ่ม
};

async function postGame<TExpected extends object>(payload: ApiPayload): Promise<TExpected> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  if (!res.ok) {
    const err = (json as ApiErr | null)?.error ?? `HTTP ${res.status}`;
    throw new Error(err);
  }
  return (json ?? {}) as TExpected;
}

/* ========================= local user identity ========================= */
function loadOrCreateUser(): PlayerInfo {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("nof.user") : null;
    if (raw) {
      const parsed = JSON.parse(raw) as PlayerInfo;
      if (parsed && typeof parsed.userId === "string" && parsed.userId.length > 0) return parsed;
    }
  } catch {}
  const user: PlayerInfo = { userId: `U${Math.random().toString(36).slice(2, 10)}`, name: null, avatar: null };
  try { if (typeof window !== "undefined") window.localStorage.setItem("nof.user", JSON.stringify(user)); } catch {}
  return user;
}

// ---------- อ่าน seat จาก URL hash ----------
function seatFromHash(): Side | undefined {
  if (typeof window === "undefined") return undefined;
  const h = window.location.hash.replace("#", "").toLowerCase();
  if (h === "host") return "p1";
  if (h === "player") return "p2";
  return undefined;
}

type UseGameReturn = {
  role: "host" | "player" | "-";
  user: PlayerInfo;
  state: ClientState | null;
  ready: () => Promise<void>;
  endPhase: () => Promise<void>;
  playCard: (index: number) => Promise<void>;
  discardForInfinite: (index: number) => Promise<void>;
  combat: (attacker: number, target: number | null, mode: "basic" | "skill" | "ult") => Promise<void>;
  ackCoin: () => Promise<void>;
  createRoom?: (roomId: string) => Promise<void>;
  joinRoom?: (roomId: string) => Promise<void>;
};

export function useGame(roomId: string): UseGameReturn {
  const user = useMemo(loadOrCreateUser, []);
  const [state, setState] = useState<ClientState | null>(null);

  // seat ที่อยากได้จาก hash (host -> p1, player -> p2)
  const preferredSeat = useMemo<Side | undefined>(() => seatFromHash(), []);

  const role: "host" | "player" | "-" = useMemo(() => {
    if (preferredSeat) return preferredSeat === "p1" ? "host" : "player";
    if (!state?.you) return "-";
    return state.you === "p1" ? "host" : "player";
  }, [state?.you, preferredSeat]);

  const refRoom = useRef(roomId);
  useEffect(() => { refRoom.current = roomId; }, [roomId]);

  const fetchState = useCallback(async () => {
    if (!refRoom.current) return;
    const data = await postGame<ApiOk<{ state: ClientState }>>({
      action: "getState",
      roomId: refRoom.current,
      userId: user.userId,
    });
    setState(data.state);
  }, [user.userId]);

  const ready = useCallback(async () => {
    await postGame<ApiOk<{ state: ClientState }>>({
      action: "ready",
      roomId,
      userId: user.userId,
      user,
      seat: preferredSeat, // << ส่ง seat ไปให้เซิร์ฟเวอร์
    }).then((res) => setState(res.state));
  }, [roomId, user, preferredSeat]);

  const endPhase = useCallback(async () => {
    await postGame<ApiOk<{ state: ClientState }>>({
      action: "endPhase",
      roomId,
      userId: user.userId,
    }).then((res) => setState(res.state));
  }, [roomId, user.userId]);

  const playCard = useCallback(async (index: number) => {
    await postGame<ApiOk<{ state: ClientState }>>({
      action: "playCard",
      roomId,
      userId: user.userId,
      index,
    }).then((res) => setState(res.state));
  }, [roomId, user.userId]);

  const discardForInfinite = useCallback(async (index: number) => {
    await postGame<ApiOk<{ state: ClientState }>>({
      action: "discardForInfinite",
      roomId,
      userId: user.userId,
      index,
    }).then((res) => setState(res.state));
  }, [roomId, user.userId]);

  const combat = useCallback(async (attacker: number, target: number | null, mode: "basic" | "skill" | "ult") => {
    await postGame<ApiOk<{ state: ClientState }>>({
      action: "combat",
      roomId,
      userId: user.userId,
      attacker,
      target,
      mode,
    }).then((res) => setState(res.state));
  }, [roomId, user.userId]);

  const ackCoin = useCallback(async () => {
    await postGame<ApiOk<{ state: ClientState }>>({
      action: "ackCoin",
      roomId,
      userId: user.userId,
    }).then((res) => setState(res.state));
  }, [roomId, user.userId]);

  const createRoom = useCallback(async (rid: string) => {
    await postGame<ApiOk<{ roomId: string }>>({
      action: "createRoom",
      roomId: rid,
      user,
      seat: "p1", // ผู้สร้างคือ host
    });
  }, [user]);

  const joinRoom = useCallback(async (rid: string) => {
    await postGame<ApiOk<{ roomId: string }>>({
      action: "joinRoom",
      roomId: rid,
      user,
      seat: preferredSeat, // ผู้เข้าร่วมอยากเป็น p2 (#player)
    });
  }, [user, preferredSeat]);

  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    (async () => {
      try {
        const data = await postGame<ApiOk<{ state: ClientState }>>({
          action: "getState",
          roomId,
          userId: user.userId,
        });
        if (alive) setState(data.state);
      } catch (err) {
        console.error("[getState:init] failed:", err);
      }
    })();
    return () => { alive = false; };
  }, [roomId, user.userId]);

  useEffect(() => {
    if (!roomId) return;
    const tick = () =>
      postGame<ApiOk<{ state: ClientState }>>({
        action: "getState",
        roomId,
        userId: user.userId,
      }).then((res) => setState(res.state)).catch(() => {});

    const iv = window.setInterval(tick, 3000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    const onFocus = () => tick();

    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [roomId, user.userId]);

  return { role, user, state, ready, endPhase, playCard, discardForInfinite, combat, ackCoin, createRoom, joinRoom };
}
