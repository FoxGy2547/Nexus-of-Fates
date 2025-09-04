"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

/* ===== Types ===== */
export type Side = "p1" | "p2";
export type ElementKind =
  | "Pyro" | "Hydro" | "Cryo" | "Electro"
  | "Geo" | "Anemo" | "Quantum" | "Imaginary" | "Neutral";
export type DicePool = Record<ElementKind, number>;
export type CharUnit = { code: string; name?: string; element: ElementKind; attack: number; hp: number; };
export type BattleState = {
  turn: Side; lastAction?: any;
  chars: Record<Side, CharUnit[]>;
  active: Record<Side, number>;
  hand: Record<Side, string[]>;
  dice: Record<Side, DicePool>;
};
export type PlayersMsg = {
  p1: { userId: string; name?: string | null; avatar?: string | null } | null;
  p2: { userId: string; name?: string | null; avatar?: string | null } | null;
};
export type GameHook = {
  you: Side | "";
  players: PlayersMsg;
  state: BattleState | null;
  endTurn: () => void; playCard: (handIndex: number) => void;
  switchActive: (index: number) => void; attackActive: () => void;
};

/* ===== helpers ===== */
type ServerUnit = { code: string; atk: number; hp: number; element: ElementKind };
type ServerState = {
  phase: "lobby" | "play";
  turn: Side; lastAction: any;
  board: Record<Side, ServerUnit[]>;
  hand: Record<Side, string[]>;
  dice: Record<Side, DicePool>;
};
function toClientState(s: ServerState | null | undefined): BattleState {
  const mapSide = (side: Side) => (s?.board?.[side] ?? []).map(u => ({
    code: u.code, element: u.element, attack: u.atk, hp: u.hp
  }));
  return {
    turn: (s?.turn ?? "p1") as Side,
    lastAction: s?.lastAction,
    chars: { p1: mapSide("p1"), p2: mapSide("p2") },
    active: { p1: 0, p2: 0 },
    hand: { p1: (s?.hand?.p1 ?? []) as string[], p2: (s?.hand?.p2 ?? []) as string[] },
    dice: { p1: (s?.dice?.p1 ?? {}) as DicePool, p2: (s?.dice?.p2 ?? {}) as DicePool },
  };
}
async function api(body: any) {
  const r = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
}
function genId() { return `g:${crypto.randomUUID()}`; }

/* ===== main hook ===== */
export function useGame(roomId: string): GameHook {
  const { data: session } = useSession();

  const [you, setYou] = useState<Side | "">("");
  const [players, setPlayers] = useState<PlayersMsg>({ p1: null, p2: null });
  const [clientState, setClientState] = useState<BattleState | null>(null);
  const serverStateRef = useRef<ServerState | null>(null);

  // clientId แบบคงที่ตลอด (ไม่ผูกกับบัญชี เพื่อกันกินสองสล็อต)
  const clientId = useMemo(() => {
    if (typeof window === "undefined") return "ssr";
    const k = "NOF_clientId";
    let id = localStorage.getItem(k);
    if (!id) { id = genId(); localStorage.setItem(k, id); }
    return id;
  }, []);

  const displayName = session?.user?.name ?? null;
  const avatar = session?.user?.image ?? null;

  // กัน StrictMode ให้บูตครั้งเดียวต่อแท็บ
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    let mounted = true;

    async function boot() {
      const me = { userId: clientId, name: displayName, avatar };

      // ถ้าแท็บนี้เคย join ห้องนี้แล้วในรอบนี้ ไม่ต้อง join ซ้ำ
      const key = `NOF_joined:${roomId}`;
      const saved = (() => { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; } })();

      try {
        let stRes: any = null;
        let plRes: any = null;
        let joined: any = null;

        if (saved && saved.userId === clientId && saved.side) {
          // พยายามดึง state + players ก่อน (ถ้าห้องถูกลบไป จะ fallback ไป create ใหม่)
          try {
            [stRes, plRes] = await Promise.all([
              api({ action: "state", roomId }),
              api({ action: "players", roomId }),
            ]);
          } catch (e: any) {
            const msg = String(e?.message ?? e);
            if (msg.includes("ROOM_NOT_FOUND")) {
              joined = await api({ action: "createRoom", roomId, user: me });
            } else {
              throw e;
            }
          }
          if (!mounted) return;

          if (joined) {
            setYou(joined.you as Side);
            setPlayers((joined.players ?? { p1: null, p2: null }) as PlayersMsg);
            serverStateRef.current = joined.state as ServerState;
            setClientState(toClientState(serverStateRef.current));
            sessionStorage.setItem(key, JSON.stringify({ userId: clientId, side: joined.you }));
          } else {
            setYou(saved.side as Side);
            setPlayers((plRes?.players ?? { p1: null, p2: null }) as PlayersMsg);
            serverStateRef.current = (stRes?.state ?? null) as ServerState;
            setClientState(toClientState(serverStateRef.current));
          }
        } else {
          // joinRoom ปกติ
          try {
            joined = await api({ action: "joinRoom", roomId, user: me });
          } catch (e:any) {
            const msg = String(e?.message ?? e);
            if (msg.includes("ROOM_NOT_FOUND")) {
              joined = await api({ action: "createRoom", roomId, user: me });
            } else { throw e; }
          }
          if (!mounted) return;

          setYou(joined.you as Side);
          setPlayers((joined.players ?? { p1: null, p2: null }) as PlayersMsg);
          serverStateRef.current = joined.state as ServerState;
          setClientState(toClientState(serverStateRef.current));
          sessionStorage.setItem(key, JSON.stringify({ userId: clientId, side: joined.you }));
        }

        // ready (idempotent)
        try {
          const rd = await api({ action: "ready", roomId, userId: clientId });
          if (rd?.state) {
            serverStateRef.current = rd.state as ServerState;
            setClientState(toClientState(serverStateRef.current));
          }
        } catch {}
      } catch (e:any) {
        alert(`Join failed: ${e?.message ?? e}`);
      }
    }

    boot();

    // polling: ดึง state + players คู่กัน
    const t = setInterval(async () => {
      try {
        const [st, pl] = await Promise.all([
          api({ action: "state", roomId }),
          api({ action: "players", roomId }),
        ]);
        setPlayers((pl?.players ?? { p1: null, p2: null }) as PlayersMsg);
        serverStateRef.current = (st.state ?? serverStateRef.current) as ServerState;
        setClientState(toClientState(serverStateRef.current));
      } catch {}
    }, 1200);

    // leave ตอนปิดแท็บ
    const leave = () => {
      try {
        navigator.sendBeacon?.(
          "/api/game",
          JSON.stringify({ action:"leave", roomId, userId: clientId })
        );
      } catch {}
    };
    window.addEventListener("beforeunload", leave);

    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", leave);
    };
  }, [roomId, clientId, displayName, avatar]);

  // อัปเดตชื่อ/รูปหลัง session มา (ใช้ userId เดิม → ไม่กินสล็อตเพิ่ม)
  useEffect(() => {
    if (!you) return;
    api({ action: "joinRoom", roomId, user: { userId: clientId, name: displayName, avatar } }).catch(()=>{});
  }, [you, displayName, avatar, roomId, clientId]);

  // actions
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

  const endTurn = () => gameAction({ kind: "endTurn" });
  const playCard = (handIndex: number) => gameAction({ kind: "playCard", index: handIndex });
  const switchActive = (index: number) => gameAction({ kind: "switch", index }); // server ตอนนี้ยังไม่รองรับ switch จริงจัง
  const attackActive = () => gameAction({ kind: "attack", index: 0 });

  return { you, players, state: clientState, endTurn, playCard, switchActive, attackActive };
}

/* ===== assets ===== */
export const CARD_IMG: Record<string, string> = {
  BLAZE_KNIGHT: "Blaze Knight.png",
  FROST_ARCHER: "Frost Archer.png",
  THUNDER_COLOSSUS: "Thunder Colossus.png",
  WINDBLADE_DUELIST: "Windblade Duelist.png",
  STONE_BULWARK: "Stone Bulwark.png",
  TIDE_MAGE: "Tide Mage.png",
  VOID_SEER: "Void Seer.png",
  MINDSHAPER: "Mindshaper.png",
  NEXUS_ADEPT: "Nexus Adept.png",
  ICE_WARDEN: "Ice Warden.png",
  CINDER_SCOUT: "Cinder Scout.png",
  WAVECALLER: "Wavecaller.png",
};
