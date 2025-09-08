"use client";

import { useEffect, useMemo, useState } from "react";

/* shared types (ให้พอใช้ใน UI) */
type Side = "p1" | "p2";
type DicePool = Record<string, number>;
type UnitVM = { code: string; attack: number; hp: number; element: string };

type ClientState =
  | {
      mode: "lobby";
      ready: { p1: boolean; p2: boolean };
      rngSeed: string;
      lastAction: unknown;
    }
  | {
      mode: "play";
      rngSeed: string;
      lastAction: unknown;
      phaseNo: number;
      turn: Side;
      hero: Record<Side, number>;
      board: Record<Side, UnitVM[]>;
      hand: Record<Side, string[]>;
      dice: Record<Side, DicePool>;
    };

type PlayersVM = {
  p1: { userId: string; name?: string | null; avatar?: string | null } | null;
  p2: { userId: string; name?: string | null; avatar?: string | null } | null;
};

type ApiOk<T extends object = {}> = { ok: true } & T;
type ApiErr = { ok: false; error: string };
type ApiRes<T extends object = {}> = ApiOk<T> | ApiErr;

async function post<T extends object>(body: unknown): Promise<ApiRes<T>> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  const asApi = (v: unknown): v is ApiRes<T> =>
    typeof v === "object" && v !== null && "ok" in (v as Record<string, unknown>);
  return asApi(data) ? (data as ApiRes<T>) : ({ ok: false, error: "BAD_RESPONSE" } as ApiErr);
}

/** userId แบบเสถียร (guest เก็บไว้ที่ localStorage) */
function stableGuestId(): string {
  if (typeof window === "undefined") return "ssr";
  const key = "NOF_guestId";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

export function useGame(roomId: string) {
  const [state, setState] = useState<ClientState | null>(null);
  const [players, setPlayers] = useState<PlayersVM>({ p1: null, p2: null });
  const [you, setYou] = useState<Side | "">("");

  const user = useMemo(() => {
    const id = stableGuestId();
    return { userId: id, name: null as string | null, avatar: null as string | null };
  }, []);

  // join
  useEffect(() => {
    if (!roomId) return;
    (async () => {
      const r = await post<{ roomId: string; you: Side; players: PlayersVM; state: ClientState }>({
        action: "joinRoom",
        roomId,
        user,
      });
      if (r.ok) {
        setYou(r.you);
        setPlayers(r.players);
        setState(r.state);
      }
    })();
  }, [roomId, user]);

  async function ready() {
    const r = await post<{ full?: boolean; state: ClientState; patch?: unknown }>({
      action: "ready",
      roomId,
      userId: user.userId,
    });
    if (r.ok) setState(r.state);
  }

  async function endTurn() {
    const r = await post<{ patch: unknown }>({
      action: "action",
      roomId,
      side: you as Side,
      payload: { kind: "endTurn" },
    });
    if (r.ok && r.patch && typeof r.patch === "object") {
      setState((s) => (s ? ({ ...s, ...(r.patch as object) } as ClientState) : s));
    }
  }

  async function endPhase() {
    const r = await post<{ patch: unknown }>({
      action: "action",
      roomId,
      side: you as Side,
      payload: { kind: "endPhase" },
    });
    if (r.ok && r.patch && typeof r.patch === "object") {
      setState((s) => (s ? ({ ...s, ...(r.patch as object) } as ClientState) : s));
    }
  }

  async function playCard(index: number) {
    const r = await post<{ patch: unknown }>({
      action: "action",
      roomId,
      side: you as Side,
      payload: { kind: "playCard", index },
    });
    if (r.ok && r.patch && typeof r.patch === "object") {
      setState((s) => (s ? ({ ...s, ...(r.patch as object) } as ClientState) : s));
    }
  }

  async function attackActive() {
    // demo: โจมตีตัวหน้าสุด (index 0)
    const r = await post<{ patch: unknown }>({
      action: "action",
      roomId,
      side: you as Side,
      payload: { kind: "attack", index: 0 },
    });
    if (r.ok && r.patch && typeof r.patch === "object") {
      setState((s) => (s ? ({ ...s, ...(r.patch as object) } as ClientState) : s));
    }
  }

  return {
    you,
    players,
    state,
    ready,
    endTurn,
    endPhase,
    playCard,
    attackActive,
  };
}
