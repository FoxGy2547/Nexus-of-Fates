// src/hooks/useGame.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { Session } from "next-auth";

/* ===================== helper ===================== */
async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });

  const raw = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const msg =
      ((json as { error?: string } | null)?.error) ??
      (raw || res.statusText || "Request failed");
    throw new Error(msg);
  }
  return (json as T) ?? ({} as T);
}

/** เสถียรทั้งแอป: auth.id > email > guestId (localStorage) */
function stableUserId(session: Session | null | undefined): string {
  if (typeof window === "undefined") return "ssr";
  const authId =
    (session?.user as { id?: string | null } | undefined)?.id ??
    session?.user?.email ??
    null;
  if (authId) return String(authId);

  const key = "NOF_guestId";
  let id = localStorage.getItem(key);
  if (!id) {
    const rnd =
      (crypto as any)?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    id = String(rnd);
    localStorage.setItem(key, id);
  }
  return id;
}

/* ===================== shared types (client) ===================== */
export type Side = "p1" | "p2";
export type DicePool = Record<string, number>;
export type UnitVM = {
  code: string;
  element: string;
  attack: number;
  hp: number;
  gauge?: number;
};
export type ClientState = {
  mode?: "lobby" | "play";
  coin?: { decided: boolean; winner?: Side };
  turn: Side;
  phaseNo?: number;
  phaseActor?: Side;
  endTurned?: Record<Side, boolean>;
  hero: Record<Side, number>;
  dice: Record<Side, DicePool>;
  board: Record<Side, UnitVM[]>;
  hand: Record<Side, string[]>;
  ready?: { p1: boolean; p2: boolean };
  players?: Partial<Record<Side, { name?: string | null; avatar?: string | null }>>;
  you?: Side; // 👈 เซิร์ฟเวอร์บอกฝั่งเรา
};

/* ===================== the hook ===================== */
export function useGame(roomIdRaw: string) {
  const { data: session } = useSession();
  const roomId = String(roomIdRaw || "").toUpperCase();

  const userId = useMemo(() => stableUserId(session), [session]);
  const user = useMemo(
    () => ({
      userId,
      name: session?.user?.name ?? "Player",
      avatar: session?.user?.image ?? null,
    }),
    [session, userId],
  );

  const [state, setState] = useState<ClientState | null>(null);
  const [role, setRole] = useState<"host" | "player" | null>(null);

  // hint role จาก localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `NOF_role:${roomId}`;
    const v = localStorage.getItem(key);
    if (v === "host" || v === "player") setRole(v);
  }, [roomId]);

  // handshake ให้แน่ใจว่า API พร้อม
  useEffect(() => {
    post<{ ok: boolean; time: number }>({ action: "hello" }).catch(() => {});
  }, []);

  // 🔗 เข้าร่วมห้องอัตโนมัติ (ครั้งเดียว)
  const joinedRef = useRef(false);
  useEffect(() => {
    if (!roomId || joinedRef.current) return;
    post<{ ok: boolean; roomId: string }>({
      action: "joinRoom",
      roomId,
      user, // { userId, name, avatar }
    })
      .catch(() => {})
      .finally(() => {
        joinedRef.current = true;
      });
  }, [roomId, user.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // pull state แบบ polling
  const pollingRef = useRef<number | null>(null);
  const pull = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await post<{ ok: true; state: ClientState }>({
        action: "getState",
        roomId,
        userId, // ให้ server ระบุ you
      });
      setState(res.state);

      // ถ้า server บอก you → ตั้ง role ให้ทันที
      const you = res.state.you;
      if (you) {
        const r = you === "p1" ? "host" : "player";
        if (role !== r) {
          setRole(r);
          if (typeof window !== "undefined") {
            localStorage.setItem(`NOF_role:${roomId}`, r);
          }
        }
      }
    } catch {
      /* noop */
    }
  }, [roomId, userId, role]);

  useEffect(() => {
    if (!roomId) return;
    pull(); // ครั้งแรก
    pollingRef.current && clearInterval(pollingRef.current);
    pollingRef.current = window.setInterval(pull, 900);
    return () => {
      pollingRef.current && clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [roomId, pull]);

  /* ========== action wrappers ========== */
  const ready = useCallback(async () => {
    await post<{ ok: boolean; state: ClientState }>({
      action: "ready",
      roomId,
      user,
    });
    await pull();
  }, [roomId, user, pull]);

  const ackCoin = useCallback(async () => {
    await post<{ ok: boolean }>({
      action: "ackCoin",
      roomId,
      userId,
    });
  }, [roomId, userId]);

  const endTurn = useCallback(async () => {
    await post<{ ok: boolean; state: ClientState }>({
      action: "endTurn",
      roomId,
      userId,
    });
    await pull();
  }, [roomId, userId, pull]);

  const endPhase = useCallback(async () => {
    await post<{ ok: boolean; state: ClientState }>({
      action: "endPhase",
      roomId,
      userId,
    });
    await pull();
  }, [roomId, userId, pull]);

  const playCard = useCallback(
    async (index: number) => {
      await post<{ ok: boolean; state: ClientState }>({
        action: "playCard",
        roomId,
        userId,
        index,
      });
      await pull();
    },
    [roomId, userId, pull],
  );

  const discardForInfinite = useCallback(
    async (index: number) => {
      await post<{ ok: boolean; state: ClientState }>({
        action: "discardForInfinite",
        roomId,
        userId,
        index,
      });
      await pull();
    },
    [roomId, userId, pull],
  );

  const combat = useCallback(
    async (attacker: number, target: number | null, mode: "basic" | "skill" | "ult") => {
      await post<{ ok: boolean; state: ClientState }>({
        action: "combat",
        roomId,
        userId,
        attacker,
        target,
        mode,
      });
      await pull();
    },
    [roomId, userId, pull],
  );

  return {
    role,
    state,
    ready,
    endTurn,
    endPhase,
    playCard,
    discardForInfinite,
    combat,
    ackCoin,
  };
}

export default useGame;
