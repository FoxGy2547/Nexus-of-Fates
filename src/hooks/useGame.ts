"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

/* ========= shared types ========= */
type Side = "p1" | "p2";
type DicePool = Record<string, number>;
type UnitVM = { code: string; attack: number; hp: number; element: string };

/** server */
type ServerLobby = {
  phase: "lobby";
  ready: { host: boolean; player: boolean };
  rngSeed?: string;
  lastAction?: unknown;
};
type ServerPlay = {
  phase: "play";
  turn: Side;
  phaseNo?: number;
  hero?: Record<Side, number>;
  dice?: Record<Side, DicePool>;
  board?: Record<Side, UnitVM[]>;
  hand?: Record<Side, string[]>;
  lastAction?: unknown;
};
type ServerState = ServerLobby | ServerPlay;

type PlayerInfo = { userId: string; name?: string | null; avatar?: string | null } | null;

type ServerPlayers = {
  host: PlayerInfo;
  player: PlayerInfo;
  spectators?: Record<string, PlayerInfo>;
};
type ActiveMap = { p1?: string | null; p2?: string | null };

type ApiStateResponse = {
  ok: boolean;
  state?: ServerState;
  players?: ServerPlayers;
  active?: ActiveMap;
};
type ApiJoinResponse = ApiStateResponse & { role?: "host" | "player" | "spectator" };
type Role = "host" | "player" | "spectator" | null;

/** client vm (เรา map ให้หน้าเดิมใช้ต่อได้) */
type ClientState =
  | {
      mode: "lobby";
      ready: { p1: boolean; p2: boolean }; // map host→p1, player→p2
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
  return (await res.json()) as T;
}

/* ========= hook ========= */
type UseGameReturn = {
  role: Role;                 // "host" | "player" | "spectator" | null
  you: Side | null;           // p1/p2 ที่แมปจาก role (spectator = null)
  players: ServerPlayers;
  state: ClientState | null;

  ready: () => Promise<void>;
  endTurn: () => Promise<void>;
  endPhase: () => Promise<void>;
  playCard: (index: number) => Promise<void>;
  attackActive: (index?: number) => Promise<void>;
};

export function useGame(roomId: string): UseGameReturn {
  const userId = useStableUserId();

  const [role, setRole] = useState<Role>(null);
  const [players, setPlayers] = useState<ServerPlayers>({ host: null, player: null });
  const [active,  setActive]  = useState<ActiveMap>({});
  const [state, setState] = useState<ClientState | null>(null);

  const timer = useRef<number | null>(null);

  const mapLobbyToClient = (s: ServerLobby): ClientState => ({
    mode: "lobby",
    ready: { p1: !!s.ready.host, p2: !!s.ready.player },
    rngSeed: s.rngSeed,
    lastAction: s.lastAction,
  });
  const mapPlayToClient = (s: ServerPlay): ClientState => ({
    mode: "play",
    turn: s.turn,
    phaseNo: s.phaseNo ?? 1,
    hero: s.hero ?? { p1: 30, p2: 30 },
    dice: s.dice ?? { p1: {}, p2: {} },
    board: s.board ?? { p1: [], p2: [] },
    hand: s.hand ?? { p1: [], p2: [] },
    lastAction: s.lastAction,
  });

  const you: Side | null = useMemo(() => {
    if (role === "host") return "p1";
    if (role === "player") return "p2";
    // เผื่อกรณีแมปจาก active (reconnect)
    if (active.p1 === userId) return "p1";
    if (active.p2 === userId) return "p2";
    return null;
  }, [role, active.p1, active.p2, userId]);

  const pull = useCallback(async () => {
    try {
      const res = await post<ApiStateResponse>({ action: "state", roomId });
      if (res.players) setPlayers(res.players);
      if (res.active) setActive(res.active);

      const s = res.state;
      if (!s) return;

      if (s.phase === "lobby") setState(mapLobbyToClient(s));
      else setState(mapPlayToClient(s));
    } catch {
      /* no-op */
    }
  }, [roomId]);

  const join = useCallback(async () => {
    try {
      const r = await post<ApiJoinResponse>({
        action: "joinRoom",
        roomId,
        user: { userId, name: null, avatar: null },
      });
      if (r.role) setRole(r.role);
      if (r.players) setPlayers(r.players);
      if (r.active) setActive(r.active);

      const s = r.state;
      if (s) setState(s.phase === "lobby" ? mapLobbyToClient(s) : mapPlayToClient(s));
    } catch {
      /* no-op */
    }
  }, [roomId, userId]);

  useEffect(() => {
    // เข้า room ครั้งแรก
    join();
    // poll บางๆ เพื่อ sync (1.5s)
    timer.current = window.setInterval(pull, 1500);
    // ดึงเมื่อโฟกัสกลับมา
    const onFocus = () => pull();
    window.addEventListener("focus", onFocus);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      window.removeEventListener("focus", onFocus);
    };
  }, [join, pull]);

  const ready = useCallback(async () => {
    if (role !== "host" && role !== "player") return;
    await post<void>({ action: "ready", roomId, role, userId });
    await pull();
  }, [role, roomId, userId, pull]);

  const ensurePlayable = () => {
    if (you !== "p1" && you !== "p2") throw new Error("Not a player");
    return you;
  };

  const endTurn = useCallback(async () => {
    const side = ensurePlayable();
    await post<void>({ action: "action", roomId, side, payload: { kind: "endTurn" } });
    await pull();
  }, [roomId, you, pull]);

  const endPhase = useCallback(async () => {
    const side = ensurePlayable();
    await post<void>({ action: "action", roomId, side, payload: { kind: "endPhase" } });
    await pull();
  }, [roomId, you, pull]);

  const playCard = useCallback(async (index: number) => {
    const side = ensurePlayable();
    await post<void>({ action: "action", roomId, side, payload: { kind: "playCard", index } });
    await pull();
  }, [roomId, you, pull]);

  const attackActive = useCallback(async (index = 0) => {
    const side = ensurePlayable();
    await post<void>({ action: "action", roomId, side, payload: { kind: "attack", index } });
    await pull();
  }, [roomId, you, pull]);

  return { role, you, players, state, ready, endTurn, endPhase, playCard, attackActive };
}
