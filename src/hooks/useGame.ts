// src/hooks/useGame.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { Session } from "next-auth";

/* =============== types shared กับ API =============== */
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
  coinAck?: Record<Side, boolean>;
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
  you?: Side; // ฝั่งของเรา (ให้เซิร์ฟเวอร์บอก)
};

type ApiOk<T> = { ok: true } & T;
type ApiError = { error: string };

/* =============== helpers =============== */

/** userId เสถียรทั้งแอป (auth.id > email > guestId localStorage) */
function stableUserId(session: Session | null | undefined): string {
  if (typeof window === "undefined") return "ssr";
  const authId =
    (session?.user as { id?: string | null } | undefined)?.id ??
    session?.user?.email ??
    null;
  if (authId) return String(authId);

  const key = "NOF_guestId";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  // สร้าง guest id ใหม่แบบไม่ใช้ any
  let rnd: string;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    rnd = crypto.randomUUID() as string;
  } else {
    rnd = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
  window.localStorage.setItem(key, rnd);
  return rnd;
}

/** POST ไป /api/game และคืน status + data (รองรับ 204) */
async function postApi<T>(
  body: Record<string, unknown>,
): Promise<{ status: number; data?: T; text?: string }> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 204) return { status: 204 };

  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    /* ignore parse error */
  }
  return { status: res.status, data: json as T | undefined, text };
}

/* =============== hook หลัก =============== */
export function useGame(roomIdRaw: string) {
  const { data: session } = useSession();
  const roomId = useMemo(() => String(roomIdRaw || "").toUpperCase(), [roomIdRaw]);

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

  // เวอร์ชัน state ล่าสุดจากเซิร์ฟเวอร์ (ใช้สำหรับ polling แบบ sinceVersion)
  const versionRef = useRef<number>(0);

  // เดางาน role จาก localStorage (ให้ UI เสถียรตอนโหลดครั้งแรก)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `NOF_role:${roomId}`;
    const saved = window.localStorage.getItem(key);
    if (saved === "host" || saved === "player") setRole(saved);
  }, [roomId]);

  // hello (warm up function)
  useEffect(() => {
    void postApi<ApiOk<{ time: number; version: number; db: string }>>({ action: "hello" });
  }, []);

  // join room อัตโนมัติครั้งแรก
  const joinedRef = useRef(false);
  useEffect(() => {
    if (!roomId || joinedRef.current) return;
    joinedRef.current = true;
    void postApi<ApiOk<{ roomId: string; version: number }>>({
      action: "joinRoom",
      roomId,
      user,
    });
  }, [roomId, user]);

  /* =============== polling แบบ backoff + sinceVersion =============== */
  const stopPollRef = useRef(false);
  useEffect(() => {
    stopPollRef.current = false;
    return () => {
      stopPollRef.current = true;
    };
  }, [roomId]);

  const pullOnce = useCallback(async () => {
    if (!roomId) return false;

    const res = await postApi<
      ApiOk<{ version: number; state: ClientState }> | ApiError
    >({
      action: "getState",
      roomId,
      userId,
      sinceVersion: versionRef.current || 0,
    });

    // 204 = ไม่มีการเปลี่ยนแปลง
    if (res.status === 204) return false;

    if (res.status >= 200 && res.status < 300 && res.data && "ok" in res.data) {
      const payload = res.data as ApiOk<{ version: number; state: ClientState }>;
      versionRef.current = payload.version;
      setState(payload.state);

      // ให้ server เป็นตัวจริงเรื่องฝั่งเรา → อัปเดต role
      const you = payload.state.you;
      if (you) {
        const newRole = you === "p1" ? "host" : "player";
        if (role !== newRole) {
          setRole(newRole);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(`NOF_role:${roomId}`, newRole);
          }
        }
      }
      return true;
    }

    // error payload
    if (res.data && "error" in (res.data as ApiError)) {
      // eslint-disable-next-line no-console
      console.warn("getState error:", (res.data as ApiError).error);
    }
    return false;
  }, [roomId, userId, role]);

  useEffect(() => {
    if (!roomId) return;

    let delay = 700; // เริ่มด้วย ~0.7s
    let timer: number | null = null;

    const loop = async () => {
      if (stopPollRef.current) return;

      const changed = await pullOnce();
      // ถ้า state เปลี่ยน → รีเซ็ตดีเลย์ให้ตอบสนองไวขึ้น
      if (changed) delay = 700;
      else delay = Math.min(delay * 1.4, 5000); // backoff สูงสุด 5s

      timer = window.setTimeout(loop, delay);
    };

    // kick off
    void loop();

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [roomId, pullOnce]);

  /* =============== action wrappers =============== */
  // ทุก action จะเซฟเวอร์ชันใหม่ → ดึงซ้ำครั้งเดียว
  const refresh = useCallback(async () => {
    await pullOnce();
  }, [pullOnce]);

  const ready = useCallback(async () => {
    await postApi<ApiOk<{ version: number; state: ClientState }> | ApiError>({
      action: "ready",
      roomId,
      user,
    });
    await refresh();
  }, [roomId, user, refresh]);

  const ackCoin = useCallback(async () => {
    await postApi<ApiOk<{ version: number; state: ClientState }> | ApiError>({
      action: "ackCoin",
      roomId,
      userId,
    });
    await refresh();
  }, [roomId, userId, refresh]);

  const endTurn = useCallback(async () => {
    await postApi<ApiOk<{ version: number; state: ClientState }> | ApiError>({
      action: "endTurn",
      roomId,
      userId,
    });
    await refresh();
  }, [roomId, userId, refresh]);

  const endPhase = useCallback(async () => {
    await postApi<ApiOk<{ version: number; state: ClientState }> | ApiError>({
      action: "endPhase",
      roomId,
      userId,
    });
    await refresh();
  }, [roomId, userId, refresh]);

  const playCard = useCallback(
    async (index: number) => {
      await postApi<ApiOk<{ version: number; state: ClientState }> | ApiError>({
        action: "playCard",
        roomId,
        userId,
        index,
      });
      await refresh();
    },
    [roomId, userId, refresh],
  );

  const discardForInfinite = useCallback(
    async (index: number) => {
      await postApi<ApiOk<{ version: number; state: ClientState }> | ApiError>({
        action: "discardForInfinite",
        roomId,
        userId,
        index,
      });
      await refresh();
    },
    [roomId, userId, refresh],
  );

  const combat = useCallback(
    async (attacker: number, target: number | null, mode: "basic" | "skill" | "ult") => {
      await postApi<ApiOk<{ version: number; state: ClientState }> | ApiError>({
        action: "combat",
        roomId,
        userId,
        attacker,
        target,
        mode,
      });
      await refresh();
    },
    [roomId, userId, refresh],
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
