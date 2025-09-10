// src/hooks/useGame.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ========== shared types (client) ========== */
export type Side = "p1" | "p2";
export type DicePool = Record<string, number>;
export type UnitVM = { code: string; element: string; attack: number; hp: number; gauge?: number };

export type ClientState = {
  mode: "lobby" | "play";
  players: Partial<Record<Side, { name?: string | null; avatar?: string | null }>>;
  coin: { decided: boolean; winner?: Side };
  coinAck: Record<Side, boolean>;
  turn: Side;
  phaseNo: number;
  phaseActor: Side;
  endTurned: Record<Side, boolean>;
  hero: Record<Side, number>;
  board: Record<Side, UnitVM[]>;
  hand: Record<Side, string[]>;
  dice: Record<Side, DicePool>;
  ready: Record<Side, boolean>;
  you?: Side;
  warnNoDeck?: string[];
};

export type Role = "host" | "player" | null;

type PlayerInfo = { userId: string; name?: string | null; avatar?: string | null };

/* ========== tiny user identity ========== */
const USER_KEY = "nof:user";

function getUser(): PlayerInfo {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem(USER_KEY) : null;
  if (raw) {
    try {
      const u = JSON.parse(raw) as unknown;
      if (u && typeof u === "object" && "userId" in u && typeof (u as { userId: unknown }).userId === "string") {
        return u as PlayerInfo;
      }
    } catch {
      // ignore and fallthrough to create anon
    }
  }
  const w = (typeof window !== "undefined" ? (window as unknown as { __USER_NAME__?: string }) : undefined);
  const anon: PlayerInfo = {
    userId: Math.random().toString(36).slice(2) + Date.now().toString(36).toUpperCase(),
    name: w?.__USER_NAME__ ?? null,
    avatar: null,
  };
  if (typeof window !== "undefined") localStorage.setItem(USER_KEY, JSON.stringify(anon));
  return anon;
}

/* ========== robust fetcher ========== */
function getErrorMessage(x: unknown): string | null {
  if (x && typeof x === "object" && "error" in x) {
    const v = (x as { error: unknown }).error;
    if (typeof v === "string") return v;
  }
  return null;
}

async function apiCall<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    if (!res.ok) throw new Error(text?.slice(0, 200) || `HTTP ${res.status}`);
    throw new Error("Server returned non-JSON response");
  }

  if (!res.ok) {
    const msg = getErrorMessage(data) ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/* ========== hook ========== */
export function useGame(roomId: string) {
  const user = useMemo(() => getUser(), []);
  const [state, setState] = useState<ClientState | null>(null);
  const [role, setRole] = useState<Role>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const decideRole = useCallback(
    (s: ClientState | null): Role => {
      if (!s) return null;
      if (!s.players?.p1 && !s.players?.p2) return "host";
      if (s.you) return s.you === "p1" ? "host" : "player";
      return role;
    },
    [role],
  );

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await apiCall<{ ok: true; state: ClientState }>({
        action: "getState",
        roomId,
        userId: user.userId,
      });
      setState(res.state);
      const r = decideRole(res.state);
      if (r !== role) setRole(r);
    } catch (e) {
      // แค่ log ไม่ทำให้ UI ตาย
      // eslint-disable-next-line no-console
      console.error("getState failed:", e);
    }
  }, [roomId, user.userId, role, decideRole]);

  useEffect(() => {
    if (!roomId) return;
    void refresh();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void refresh(), 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [roomId, refresh]);

  /* ---- room ops (หน้าแรก) ---- */
  const createRoom = useCallback(async () => {
    if (!roomId) throw new Error("Missing roomId");
    const res = await apiCall<{ ok: true; roomId: string }>({ action: "createRoom", roomId, user });
    return res.roomId;
  }, [roomId, user]);

  const joinRoom = useCallback(async () => {
    if (!roomId) throw new Error("Missing roomId");
    const res = await apiCall<{ ok: true; roomId: string }>({ action: "joinRoom", roomId, user });
    return res.roomId;
  }, [roomId, user]);

  /* ---- in-game ops ---- */
  const ready = useCallback(async () => {
    await apiCall({ action: "ready", roomId, user });
    await refresh();
  }, [roomId, user, refresh]);

  const ackCoin = useCallback(async () => {
    await apiCall({ action: "ackCoin", roomId, user });
    await refresh();
  }, [roomId, user, refresh]);

  const endPhase = useCallback(async () => {
    await apiCall({ action: "endPhase", roomId, user });
    await refresh();
  }, [roomId, user, refresh]);

  const playCard = useCallback(
    async (index: number) => {
      await apiCall({ action: "playCard", roomId, user, index });
      await refresh();
    },
    [roomId, user, refresh],
  );

  const discardForInfinite = useCallback(
    async (index: number) => {
      await apiCall({ action: "discardForInfinite", roomId, user, index });
      await refresh();
    },
    [roomId, user, refresh],
  );

  const combat = useCallback(
    async (attacker: number, target: number | null, mode: "basic" | "skill" | "ult") => {
      await apiCall({ action: "combat", roomId, user, attacker, target, mode });
      await refresh();
    },
    [roomId, user, refresh],
  );

  const you: Side | null = useMemo(() => {
    const s = state;
    if (!s) return null;
    if (s.you) return s.you;
    if (s.players?.p1?.name === user.name) return "p1";
    if (s.players?.p2?.name === user.name) return "p2";
    return null;
  }, [state, user.name]);

  return {
    state,
    role,
    you,
    refresh,
    createRoom,
    joinRoom,
    ready,
    ackCoin,
    endPhase,
    playCard,
    discardForInfinite,
    combat,
  };
}
