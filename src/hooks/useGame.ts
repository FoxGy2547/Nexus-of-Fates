"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ---------- types ที่ปราศจาก any / {} ---------- */
type Side = "p1" | "p2";

/** payload สำหรับ /api/game */
type GameActionPayload =
  | { kind: "playCard"; index: number }
  | { kind: "attack"; index: number }
  | { kind: "endTurn" }
  | { kind: "endPhase" }
  | Record<string, unknown>;

type PostCreateRoom = { ok: boolean; roomId: string; you?: Side; state?: unknown };
type PostJoinRoom   = {
  ok: boolean;
  roomId: string;
  you: Side | "-";
  players?: { p1: Record<string, unknown> | null; p2: Record<string, unknown> | null };
  state?: unknown;
};
type PostPlayers    = { ok: boolean; players: { p1: Record<string, unknown> | null; p2: Record<string, unknown> | null } };
type PostState      = {
  ok: boolean;
  state: unknown;
  players?: { p1: Record<string, unknown> | null; p2: Record<string, unknown> | null };
};
type PostReady      = { ok: boolean; full?: boolean; state?: unknown; patch?: Record<string, unknown> };
type PostAction     = { ok: boolean; patch: unknown | null; winner: Side | null };

/* ---------- utils ---------- */
async function postJSON<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // แปลงเป็นข้อความให้ครบ ๆ ไม่ใช้ any
    const msg = (await res.text().catch(() => "")) || res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** สร้าง userId ที่เสถียร (ไม่พึ่ง any) */
function stableUserId(session: unknown): string {
  // โครงสร้าง session ที่เราใช้จริง
  type MaybeSess = {
    user?: { id?: string; email?: string | null } | null;
  };

  if (typeof window === "undefined") return "ssr";
  const s = (session ?? {}) as MaybeSess;
  const authId = s.user?.id ?? s.user?.email ?? null;
  if (authId) return String(authId);

  const key = "NOF_guestId";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(key, id);
  }
  return id;
}

/* ---------- hook หลัก ---------- */
export function useGame(roomId: string, session?: unknown) {
  const mounted = useRef(false);

  const youRef = useRef<Side | "-">("-");
  const [you, setYou] = useState<Side | "-">("-");
  const [players, setPlayers] = useState<{ p1: Record<string, unknown> | null; p2: Record<string, unknown> | null }>({
    p1: null,
    p2: null,
  });
  const [state, setState] = useState<unknown>(null);

  const user = useMemo(() => {
    // โครงสร้าง session ที่ใช้ชื่อ/รูป
    type MaybeSess = {
      user?: { name?: string | null; image?: string | null } | null;
    };
    const s = (session ?? {}) as MaybeSess;
    return {
      userId: stableUserId(session),
      name: s.user?.name ?? "Player",
      avatar: s.user?.image ?? null,
    };
  }, [session]);

  /* ----- join room (ครั้งแรก) ----- */
  useEffect(() => {
    mounted.current = true;

    (async () => {
      if (!roomId) return;

      // ถ้าห้องยังไม่มีให้สร้างก่อน (ไม่ซีเรียส response)
      try {
        await postJSON<PostCreateRoom>({ action: "createRoom", roomId, user });
      } catch {
        /* ignore */
      }

      // join ห้อง
      try {
        const res = await postJSON<PostJoinRoom>({ action: "joinRoom", roomId, user });
        if (!mounted.current) return;
        youRef.current = res.you;
        setYou(res.you);
        if (res.players) setPlayers(res.players);
        if (typeof res.state !== "undefined") setState(res.state);
      } catch (err) {
        console.error("[useGame] joinRoom failed:", err);
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, [roomId, user.userId]); // เปลี่ยนเฉพาะเมื่อจริง ๆ เปลี่ยน

  /* ----- โพลสถานะเป็นระยะ ----- */
  useEffect(() => {
    if (!roomId) return;

    let timer: number | undefined;

    const tick = async () => {
      try {
        const res = await postJSON<PostState>({ action: "state", roomId });
        if (!mounted.current) return;
        if (res.players) setPlayers(res.players);
        setState(res.state);
      } catch (err) {
        console.error("[useGame] poll state failed:", err);
      } finally {
        // โพลต่อทุก ~900ms
        timer = window.setTimeout(tick, 900);
      }
    };

    timer = window.setTimeout(tick, 300);
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [roomId]);

  /* ----- commands ----- */
  const ready = useCallback(async () => {
    const side = youRef.current === "-" ? undefined : youRef.current;
    const res = await postJSON<PostReady>({ action: "ready", roomId, side, userId: user.userId });
    if (typeof res.state !== "undefined") setState(res.state);
  }, [roomId, user.userId]);

  const action = useCallback(
    async (payload: GameActionPayload) => {
      const side = (youRef.current === "p1" || youRef.current === "p2") ? youRef.current : "p1";
      const res = await postJSON<PostAction>({ action: "action", roomId, side, payload });
      if (!res.ok) return;
      if (res.patch && typeof state === "object" && state !== null) {
        // รวม patch แบบปลอดภัย โดยไม่ใช้ any
        setState((prev: unknown) => {
          if (
            typeof prev === "object" &&
            prev !== null &&
            typeof res.patch === "object" &&
            res.patch !== null
          ) {
            return {
              ...(prev as Record<string, unknown>),
              ...(res.patch as Record<string, unknown>),
            };
          }
          return prev ?? (res.patch as unknown) ?? null;
        });
      }
    },
    [roomId, state]
  );

  const playCard = useCallback((index: number) => action({ kind: "playCard", index }), [action]);
  const endTurn   = useCallback(() => action({ kind: "endTurn" }), [action]);
  const endPhase  = useCallback(() => action({ kind: "endPhase" }), [action]);
  const attackActive = useCallback(() => action({ kind: "attack", index: 0 }), [action]);

  return {
    you,
    players,
    state,
    ready,
    playCard,
    endTurn,
    endPhase,
    attackActive,
  };
}
