"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

/* ===== Types ===== */
export type Side = "p1" | "p2";
export type ElementKind =
  | "Pyro" | "Hydro" | "Cryo" | "Electro"
  | "Geo" | "Anemo" | "Quantum" | "Imaginary" | "Neutral";
export type DicePool = Record<ElementKind, number>;
export type CharUnit = { code: string; element: ElementKind; attack: number; hp: number; };
export type BattleState = {
  mode: "lobby" | "play";
  phaseNo?: number;
  turn?: Side;
  lastAction?: any;
  hero?: Record<Side, number>;
  hand: Record<Side, string[]>;
  board: Record<Side, CharUnit[]>;
  dice: Record<Side, DicePool>;
  ready?: { p1: boolean; p2: boolean };
};
export type PlayersMsg = {
  p1: { userId: string; name?: string | null; avatar?: string | null } | null;
  p2: { userId: string; name?: string | null; avatar?: string | null } | null;
};
export type GameHook = {
  you: Side | "";
  players: PlayersMsg;
  state: BattleState | null;
  ready: () => void;
  endTurn: () => void;
  endPhase: () => void;
  playCard: (handIndex: number) => void;
  switchActive: (index: number) => void;
  attackActive: () => void;
};

/* ===== server mapping ===== */
type ServerUnit = { code: string; atk: number; hp: number; element: ElementKind };
type ServerState =
  | { phase: "lobby"; ready: { p1: boolean; p2: boolean }; rngSeed: string; lastAction: any }
  | {
      phase: "play"; rngSeed: string; phaseNo: number; turn: Side; lastAction: any;
      hero: Record<Side, number>;
      hand: Record<Side, string[]>;
      board: Record<Side, ServerUnit[]>;
      dice: Record<Side, DicePool>;
    };

function toClientState(s: ServerState | null | undefined): BattleState {
  if (!s) return { mode: "lobby", hand:{p1:[],p2:[]}, board:{p1:[],p2:[]}, dice:{p1:{} as DicePool, p2:{} as DicePool} };
  if (s.phase === "lobby") {
    return {
      mode: "lobby",
      lastAction: s.lastAction,
      hand: { p1: [], p2: [] },
      board: { p1: [], p2: [] },
      dice: { p1: {} as DicePool, p2: {} as DicePool },
      ready: s.ready,
    };
  }
  const mapSide = (side: Side) => (s.board[side] ?? []).map(u => ({ code:u.code, element:u.element, attack:u.atk, hp:u.hp }));
  return {
    mode: "play",
    phaseNo: s.phaseNo,
    turn: s.turn,
    lastAction: s.lastAction,
    hero: s.hero,
    hand: { p1: (s.hand.p1??[]) as string[], p2: (s.hand.p2??[]) as string[] },
    board: { p1: mapSide("p1"), p2: mapSide("p2") },
    dice: s.dice,
  };
}

async function api(body: unknown) {
  const r = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j?.error === "string" ? j.error : JSON.stringify(j));
  return j;
}

/* ===== user id แบบเดียวทั้งแอป ===== */
/** ใช้ id จาก next-auth ถ้ามี; ถ้าไม่มีใช้ guest id จาก localStorage (คงที่ทุกแท็บ) */
function stableUserId(session: any): string {
  if (typeof window === "undefined") return "ssr";
  const authId =
    (session?.user as any)?.id ??
    session?.user?.email ??
    null;
  if (authId) return String(authId);
  const key = "NOF_guestId";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

/* ===== main hook ===== */
export function useGame(roomId: string): GameHook {
  const { data: session, status } = useSession();

  const userId = useMemo(() => stableUserId(session), [status, session]);
  const displayName = session?.user?.name ?? null;
  const avatar = session?.user?.image ?? null;

  const [you, setYou] = useState<Side | "">("");
  const [players, setPlayers] = useState<PlayersMsg>({ p1: null, p2: null });
  const [clientState, setClientState] = useState<BattleState | null>(null);
  const serverStateRef = useRef<ServerState | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const me = { userId, name: displayName, avatar };

      try {
        let joined: any;
        try {
          // เข้าห้องก่อน (ถ้าห้องยังไม่มี server จะ create ให้อัตโนมัติจากหน้า Home)
          joined = await api({ action: "joinRoom", roomId, user: me });
        } catch (e:any) {
          const msg = String(e?.message ?? e);
          if (msg.includes("ROOM_NOT_FOUND")) {
            joined = await api({ action: "createRoom", roomId, user: me });
          } else { throw e; }
        }
        if (!mounted) return;

        setYou(joined.you as Side);
        setPlayers(joined.players as PlayersMsg);
        serverStateRef.current = joined.state as ServerState;
        setClientState(toClientState(serverStateRef.current));
      } catch (e:any) {
        alert(`Join failed: ${e?.message ?? e}`);
      }
    })();

    // polling
    const t = setInterval(async () => {
      try {
        const st = await api({ action: "state", roomId });
        setPlayers(st.players as PlayersMsg);
        serverStateRef.current = (st.state ?? serverStateRef.current) as ServerState;
        setClientState(toClientState(serverStateRef.current));
      } catch {}
    }, 1200);

    return () => { mounted = false; clearInterval(t); };
  }, [roomId, userId, displayName, avatar]);

  // sync ชื่อ/รูป หลัง session มา แต่ userId เดิม
  useEffect(() => {
    if (!you) return;
    api({ action: "joinRoom", roomId, user: { userId, name: displayName, avatar } }).catch(()=>{});
  }, [you, displayName, avatar, roomId, userId]);

  async function gameAction(payload: any) {
    if (!you) return;
    try {
      const res = await api({ action: "action", roomId, side: you, payload });
      if (res.patch && serverStateRef.current) {
        serverStateRef.current = { ...(serverStateRef.current as any), ...(res.patch as any) };
      }
      setClientState(toClientState(serverStateRef.current));
      if (res.winner) alert(`Winner: ${res.winner}`);
    } catch (e: any) {
      alert(`HTTP 400 /api/game → ${e?.message ?? e}`);
    }
  }

  const ready     = () =>
    api({ action: "ready", roomId, userId })
      .then((res)=> {
        serverStateRef.current = (res.state ?? serverStateRef.current) as ServerState;
        setClientState(toClientState(serverStateRef.current));
      })
      .catch(e => alert(e?.message ?? e));

  const endTurn   = () => gameAction({ kind: "endTurn" });
  const endPhase  = () => gameAction({ kind: "endPhase" });
  const playCard  = (handIndex: number) => gameAction({ kind: "playCard", index: handIndex });
  const switchActive = (_index: number) => {}; // ไว้ต่อยอดภายหลัง
  const attackActive = () => gameAction({ kind: "attack", index: 0 });

  return { you, players, state: clientState, ready, endTurn, endPhase, playCard, switchActive, attackActive };
}
