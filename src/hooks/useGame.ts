// src/hooks/useGame.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ======================= shared types (client) ======================= */
export type Side = "p1" | "p2";
export type DicePool = Record<string, number>;
export type UnitVM = { code: string; element: string; attack: number; hp: number; gauge?: number };

export type ClientState = {
  mode: "lobby" | "play";
  players: Partial<
    Record<
      Side,
      {
        name?: string | null;
        avatar?: string | null;
      }
    >
  >;
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

/* ======================= tiny user identity ======================= */
const USER_KEY = "nof:user";
function getUser(): PlayerInfo {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem(USER_KEY) : null;
  if (raw) {
    try {
      const u = JSON.parse(raw);
      if (u?.userId) return u;
    } catch {}
  }
  // สร้างแบบง่าย ๆ ถ้ายังไม่มี
  const anon: PlayerInfo = {
    userId: Math.random().toString(36).slice(2) + Date.now().toString(36).toUpperCase(),
    name: (typeof window !== "undefined" && (window as any).__USER_NAME__) || null,
    avatar: null,
  };
  if (typeof window !== "undefined") localStorage.setItem(USER_KEY, JSON.stringify(anon));
  return anon;
}

/* ======================= robust fetcher ======================= */
async function apiCall<T = any>(payload: Record<string, any>): Promise<T> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), // << สำคัญ
    cache: "no-store",
  });

  // กันกรณี server ตอบไม่ใช่ JSON
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) {
      throw new Error(text?.slice(0, 200) || `HTTP ${res.status}`);
    } else {
      throw new Error("Server returned non-JSON response");
    }
  }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

/* ======================= hook ======================= */
export function useGame(roomId: string) {
  const user = useMemo(() => getUser(), []);
  const [state, setState] = useState<ClientState | null>(null);
  const [role, setRole] = useState<Role>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ตัดสินบทบาทจากว่าห้องมีเราเป็น p1/p2 หรือยังว่าง
  const decideRole = useCallback((s: ClientState | null): Role => {
    if (!s) return null;
    const p1 = s.players?.p1?.name ?? null;
    const p2 = s.players?.p2?.name ?? null;
    // ถ้าเราสร้างห้องก่อน (หน้า /play/{room} ที่มากด Create จากหน้าแรก) ให้ถือเป็น host
    // client ฝั่งหน้า index ควรเรียก createRoom ก่อน push ไปที่ /play/{room}
    // ที่นี่จะ fallback ให้เป็น host ถ้าในห้องยังว่าง
    if (!p1 && !p2) return "host";
    if (s.you) return s.you === "p1" ? "host" : "player";
    return role;
  }, [role]);

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
      console.error("getState failed:", e);
    }
  }, [roomId, user.userId, role, decideRole]);

  // เริ่ม polling
  useEffect(() => {
    if (!roomId) return;
    refresh();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(refresh, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [roomId, refresh]);

  /* -------- room ops (create/join) — ใช้บนหน้าแรก -------- */
  const createRoom = useCallback(async () => {
    if (!roomId) throw new Error("Missing roomId");
    const res = await apiCall<{ ok: true; roomId: string }>({
      action: "createRoom",
      roomId,
      user,
    });
    return res.roomId;
  }, [roomId, user]);

  const joinRoom = useCallback(async () => {
    if (!roomId) throw new Error("Missing roomId");
    const res = await apiCall<{ ok: true; roomId: string }>({
      action: "joinRoom",
      roomId,
      user,
    });
    return res.roomId;
  }, [roomId, user]);

  /* -------- in-game ops -------- */
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

  /* -------- derive helpers -------- */
  const you: Side | null = useMemo(() => {
    const s = state;
    if (!s) return null;
    // server จะส่ง field you อยู่แล้ว แต่ fallback ให้
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
    // lobby ops (ใช้หน้าแรก)
    createRoom,
    joinRoom,
    // game ops (ใช้ในหน้า play)
    ready,
    ackCoin,
    endPhase,
    playCard,
    discardForInfinite,
    combat,
  };
}
