// src/app/api/game/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

/* Next.js route config */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===================== Types ===================== */
type Side = "p1" | "p2";
type Element =
  | "Pyro" | "Hydro" | "Cryo" | "Electro"
  | "Geo" | "Anemo" | "Quantum" | "Imaginary" | "Neutral";

type DicePool = Record<Element, number>;
type PlayerInfo = { userId: string; name?: string | null; avatar?: string | null };
type Unit = { code: string; atk: number; hp: number; element: Element };

type LobbyState = {
  phase: "lobby";
  ready: { p1: boolean; p2: boolean };
  rngSeed: string;
  lastAction: unknown;
};

type BattleState = {
  phase: "play";
  rngSeed: string;
  lastAction: unknown;

  phaseNo: number;
  phaseStarter: Side;
  phaseEnded: { p1: boolean; p2: boolean };

  turn: Side;
  playedCount: { p1: number; p2: number };
  temp: { p1: { plusDmg: number; shieldNext: number }; p2: { plusDmg: number; shieldNext: number } };

  hero: { p1: number; p2: number };
  deck: { p1: string[]; p2: string[] };
  hand: { p1: string[]; p2: string[] };
  board: { p1: Unit[]; p2: Unit[] };
  discard: { p1: string[]; p2: string[] };
  dice: { p1: DicePool; p2: DicePool };
};

type RoomState = LobbyState | BattleState;

type Room = {
  id: string;
  seed: string;
  p1: PlayerInfo | null;
  p2: PlayerInfo | null;
  state: RoomState;
};

type Body =
  | { action: "createRoom"; roomId?: string; user: PlayerInfo }
  | { action: "joinRoom"; roomId: string; user: PlayerInfo }
  | { action: "leave"; roomId: string; userId: string }
  | { action: "players"; roomId: string }
  | { action: "state"; roomId: string }
  | { action: "ready"; roomId: string; side?: Side; userId?: string }
  | {
      action: "action";
      roomId: string;
      side: Side;
      userId?: string;
      payload:
        | { kind: "playCard"; index: number }
        | { kind: "attack"; index: number }
        | { kind: "endTurn" }
        | { kind: "endPhase" }
        | Record<string, unknown>;
    };

/* ===================== RNG & utils ===================== */
function hashToSeed(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], seed: string) {
  const rng = mulberry32(hashToSeed(seed));
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i++) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ELEMENTS: Element[] = ["Pyro","Hydro","Cryo","Electro","Geo","Anemo","Quantum","Imaginary","Neutral"];
function emptyDice(): DicePool { const d = {} as DicePool; for (const e of ELEMENTS) d[e] = 0; return d; }
function rollDice(seed: string, n = 10): DicePool {
  const rng = mulberry32(hashToSeed(seed));
  const d = emptyDice();
  for (let i = 0; i < n; i++) {
    const e = ELEMENTS[Math.floor(rng() * ELEMENTS.length)];
    d[e] += 1;
  }
  return d;
}

/* ===================== Cards fallback ===================== */
type CardStats = { atk: number; hp: number; element: Element; ability?: string; cost: number };
const CARD_STATS: Record<string, CardStats> = {
  BLAZE_KNIGHT: { element: "Pyro", atk: 5, hp: 4, cost: 3 },
  FROST_ARCHER: { element: "Cryo", atk: 3, hp: 3, cost: 2 },
  THUNDER_COLOSSUS: { element: "Electro", atk: 6, hp: 7, cost: 4 },
  WINDBLADE_DUELIST: { element: "Anemo", atk: 3, hp: 2, cost: 1 },
  STONE_BULWARK: { element: "Geo", atk: 2, hp: 6, cost: 2 },
  TIDE_MAGE: { element: "Hydro", atk: 2, hp: 4, cost: 2 },
  VOID_SEER: { element: "Quantum", atk: 4, hp: 3, cost: 3 },
  MINDSHAPER: { element: "Imaginary", atk: 3, hp: 3, cost: 3 },
  NEXUS_ADEPT: { element: "Neutral", atk: 2, hp: 2, cost: 1 },
  ICE_WARDEN: { element: "Cryo", atk: 4, hp: 5, cost: 3 },
  CINDER_SCOUT: { element: "Pyro", atk: 3, hp: 2, cost: 1 },
  WAVECALLER: { element: "Hydro", atk: 2, hp: 5, cost: 2 },
};

/* ===================== DB helpers ===================== */
type RoomRow = RowDataPacket & {
  id: string;
  seed: string;
  p1: string | null;
  p2: string | null;
  state: string | null;
};

function parsePlayer(json: string | null): PlayerInfo | null {
  if (!json) return null;
  try { return JSON.parse(json) as PlayerInfo; } catch { return null; }
}
function parseState(json: string | null, seedFallback: string): RoomState {
  if (!json) return newLobby(seedFallback);
  try {
    const st = JSON.parse(json) as RoomState;
    if (!("phase" in st)) return newLobby(seedFallback);
    return st;
  } catch {
    return newLobby(seedFallback);
  }
}

async function loadRoom(roomId: string): Promise<Room> {
  const pool = getPool();
  const [rows] = await pool.query<RoomRow[]>(
    "SELECT id, seed, p1, p2, state FROM rooms WHERE id=? LIMIT 1",
    [roomId]
  );
  if (rows.length === 0) {
    const seed = randomUUID();
    const lobby = newLobby(seed);
    await pool.query<ResultSetHeader>(
      "INSERT INTO rooms (id, seed, p1, p2, state) VALUES (?, ?, NULL, NULL, ?)",
      [roomId, seed, JSON.stringify(lobby)]
    );
    return { id: roomId, seed, p1: null, p2: null, state: lobby };
  }
  const r = rows[0];
  return {
    id: r.id,
    seed: r.seed,
    p1: parsePlayer(r.p1),
    p2: parsePlayer(r.p2),
    state: parseState(r.state, r.seed),
  };
}

async function saveRoom(room: Room): Promise<void> {
  const pool = getPool();
  await pool.query<ResultSetHeader>(
    "UPDATE rooms SET seed=?, p1=?, p2=?, state=? WHERE id=?",
    [
      room.seed,
      room.p1 ? JSON.stringify(room.p1) : null,
      room.p2 ? JSON.stringify(room.p2) : null,
      JSON.stringify(room.state),
      room.id,
    ]
  );
}

/* ===================== Room & gameplay helpers ===================== */
function newLobby(seed: string): LobbyState {
  return { phase: "lobby", ready: { p1: false, p2: false }, rngSeed: seed, lastAction: null };
}
function isLobby(st: RoomState): st is LobbyState { return st.phase === "lobby"; }

function startPlayFromLobby(lobby: LobbyState): BattleState {
  const seed = lobby.rngSeed;

  const codes = Object.keys(CARD_STATS);
  const isChar = (c: string) => CARD_STATS[c].atk > 0 && CARD_STATS[c].hp > 0;
  const chars = codes.filter(isChar);
  const others = codes.filter((c) => !isChar(c));

  const pick3 = (suffix: string) => shuffle(chars, `${seed}:${suffix}`).slice(0, 3);
  const mkUnit = (code: string): Unit => {
    const s = CARD_STATS[code];
    return { code, atk: s.atk, hp: s.hp, element: s.element };
  };

  const st: BattleState = {
    phase: "play",
    rngSeed: seed,
    lastAction: null,

    phaseNo: 1,
    phaseStarter: "p1",
    phaseEnded: { p1: false, p2: false },

    turn: "p1",

    hero: { p1: 30, p2: 30 },

    deck: { p1: shuffle(others, `${seed}:deck:p1`), p2: shuffle(others, `${seed}:deck:p2`) },
    hand: { p1: [], p2: [] },

    board: { p1: pick3("chars:p1").map(mkUnit), p2: pick3("chars:p2").map(mkUnit) },
    discard: { p1: [], p2: [] },

    dice: { p1: emptyDice(), p2: emptyDice() },

    playedCount: { p1: 0, p2: 0 },
    temp: { p1: { plusDmg: 0, shieldNext: 0 }, p2: { plusDmg: 0, shieldNext: 0 } },
  };

  st.dice.p1 = rollDice(`${seed}:phase:1:p1`, 10);
  st.dice.p2 = rollDice(`${seed}:phase:1:p2`, 10);
  st.hand.p1.push(...st.deck.p1.splice(0, 4));
  st.hand.p2.push(...st.deck.p2.splice(0, 4));

  return st;
}

function startTurn(st: BattleState, side: Side) {
  st.temp[side] = { plusDmg: 0, shieldNext: 0 };
  st.playedCount[side] = 0;
  st.hand[side].push(...st.deck[side].splice(0, 2));
}
function endTurnAndPass(st: BattleState) {
  const next: Side = st.turn === "p1" ? "p2" : "p1";
  st.turn = next;
  startTurn(st, next);
}

function doPlayCard(st: BattleState, side: Side, index: number) {
  const hand = st.hand[side];
  if (index < 0 || index >= hand.length) return { ok: false, error: "Invalid hand index" } as const;
  const code = hand[index];
  const cs = CARD_STATS[code];
  if (!cs) return { ok: false, error: "Unknown card" } as const;

  const need = cs.cost ?? 0;
  if ((st.dice[side][cs.element] ?? 0) < need)
    return { ok: false, error: "Not enough dice" } as const;

  st.dice[side][cs.element] -= need;
  hand.splice(index, 1);

  if (cs.atk > 0 && cs.hp > 0) {
    const hp = cs.hp + st.temp[side].shieldNext;
    st.temp[side].shieldNext = 0;
    st.board[side].push({ code, atk: cs.atk, hp, element: cs.element });
  } else {
    st.temp[side].plusDmg += 1;
  }

  st.playedCount[side] += 1;
  st.lastAction = { kind: "playCard", side, code };
  return { ok: true, patch: { hand: st.hand, board: st.board, dice: st.dice, lastAction: st.lastAction } } as const;
}

function doAttack(st: BattleState, side: Side, idx: number) {
  const me = st.board[side];
  if (idx < 0 || idx >= me.length) return { ok: false, error: "Invalid board index" } as const;
  const unit = me[idx];
  const foeSide: Side = side === "p1" ? "p2" : "p1";
  const foe = st.board[foeSide];

  const dmg = unit.atk + st.temp[side].plusDmg + (unit.code === "BLAZE_KNIGHT" ? 1 : 0);

  if (foe.length > 0) {
    const t = foe[0];
    t.hp -= dmg;
    unit.hp -= t.atk;
    st.lastAction = { kind: "attackUnit", side, code: unit.code, target: t.code, dmg, coun: t.atk };
    if (t.hp <= 0) { foe.shift(); st.discard[foeSide].push(t.code); }
    if (unit.hp <= 0) { me.splice(idx, 1); st.discard[side].push(unit.code); }
    return { ok: true, patch: { board: st.board, discard: st.discard, lastAction: st.lastAction } } as const;
  } else {
    st.hero[foeSide] = Math.max(0, st.hero[foeSide] - dmg);
    st.lastAction = { kind: "attackHero", side, code: unit.code, dmg };
    if (st.hero[foeSide] <= 0) return { ok: true, patch: { hero: st.hero, lastAction: st.lastAction }, winner: side } as const;
    return { ok: true, patch: { hero: st.hero, lastAction: st.lastAction } } as const;
  }
}

function doEndPhase(st: BattleState, side: Side) {
  if (st.phaseEnded[side]) return { ok: true } as const;
  st.phaseEnded[side] = true;
  st.lastAction = { kind: "endPhase", side, phaseNo: st.phaseNo };

  if (st.phaseEnded.p1 && st.phaseEnded.p2) {
    st.phaseNo += 1;
    st.phaseStarter = side;
    st.turn = st.phaseStarter;
    st.phaseEnded = { p1: false, p2: false };

    st.dice.p1 = rollDice(`${st.rngSeed}:phase:${st.phaseNo}:p1`, 10);
    st.dice.p2 = rollDice(`${st.rngSeed}:phase:${st.phaseNo}:p2`, 10);

    (["p1", "p2"] as const).forEach(s => {
      st.hand[s].push(...st.deck[s].splice(0, 4));
    });
  }
  return { ok: true, patch: { lastAction: st.lastAction, dice: st.dice, hand: st.hand, turn: st.turn } } as const;
}

/* ===== applyAction ===== */
type ApplyOk = { ok: true; patch?: Partial<BattleState> | null; winner?: Side | null };
type ApplyErr = { ok: false; error: string };
type ApplyRes = ApplyOk | ApplyErr;

function applyAction(state: RoomState, side: Side, payload: unknown): ApplyRes {
  if (state.phase !== "play") return { ok: false, error: "Game not started" };
  const st = state as BattleState;

  const p = payload as { kind?: string; index?: number };
  if (p.kind === "endPhase") return doEndPhase(st, side);
  if (st.turn !== side && p.kind !== "endPhase") return { ok: false, error: "Not your turn" };

  if (p.kind === "playCard") return doPlayCard(st, side, Number(p.index ?? -1));
  if (p.kind === "attack") return doAttack(st, side, Number(p.index ?? -1));
  if (p.kind === "endTurn") { endTurnAndPass(st); st.lastAction = { kind: "endTurn" }; return { ok: true, patch: { turn: st.turn, lastAction: st.lastAction, hand: st.hand } }; }

  st.lastAction = payload as unknown;
  return { ok: true, patch: { lastAction: st.lastAction } };
}

/* ===================== Route handlers ===================== */
export function GET() {
  return NextResponse.json({ ok: true, route: "game" });
}

function hasActionField(v: unknown): v is { action: Body["action"] } {
  return typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).action === "string";
}

function envOk() {
  return !!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
}

export async function POST(req: Request) {
  const reqId = randomUUID();
  const t0 = Date.now();
  try {
    const url = new URL(req.url);
    const diag = url.searchParams.get("diag") === "1";

    const rawText = await req.text();
    let raw: unknown = null;
    try { raw = rawText ? JSON.parse(rawText) : null; } catch {
      console.error(`[api/game][${reqId}] BAD_JSON body=`, rawText?.slice(0, 500));
      return NextResponse.json({ ok: false, reqId, error: "BAD_JSON" }, { status: 400 });
    }

    console.log(`[api/game][${reqId}] start ua="${req.headers.get("user-agent")}" ip="${req.headers.get("x-forwarded-for") || "?"}" env=${envOk() ? "ok" : "missing"}`);

    if (!hasActionField(raw)) {
      return NextResponse.json({ ok: false, reqId, error: "BAD_BODY" }, { status: 400 });
    }
    const body = raw as Body;

    if (!envOk()) {
      throw new Error("ENV_MISSING: DB_HOST/DB_USER/DB_NAME not set");
    }

    if (diag) {
      try {
        const pool = getPool();
        const [rows] = await pool.query("SELECT 1 as ok");
        console.log(`[api/game][${reqId}] DB ping:`, rows);
      } catch (ex: unknown) {
        const err = ex as Error;
        console.error(`[api/game][${reqId}] DB_PING_FAIL:`, err.message || String(ex));
      }
    }

    if (body.action === "createRoom") {
      const roomId = (body.roomId || randomUUID().slice(0, 6)).toUpperCase();
      const room = await loadRoom(roomId);
      room.p1 = body.user;
      room.p2 = room.p2 ?? null;
      room.state = isLobby(room.state) ? room.state : newLobby(room.seed);
      await saveRoom(room);
      const ms = Date.now() - t0;
      console.log(`[api/game][${reqId}] createRoom ${roomId} in ${ms}ms`);
      return NextResponse.json({ ok: true, reqId, roomId, you: "p1" as const, players: { p1: room.p1, p2: room.p2 }, state: room.state });
    }

    if (body.action === "joinRoom") {
      const roomId = body.roomId.toUpperCase();
      const room = await loadRoom(roomId);
      if (!room.p1) {
        room.p1 = body.user;
      } else if (!room.p2) {
        room.p2 = body.user;
      } else {
        if (room.p1.userId === body.user.userId) room.p1 = body.user;
        else if (room.p2.userId === body.user.userId) room.p2 = body.user;
        else return NextResponse.json({ ok: false, reqId, error: "ROOM_FULL" }, { status: 400 });
      }
      await saveRoom(room);
      const you: Side = room.p1?.userId === body.user.userId ? "p1" : "p2";
      const ms = Date.now() - t0;
      console.log(`[api/game][${reqId}] joinRoom ${roomId} as ${you} in ${ms}ms`);
      return NextResponse.json({ ok: true, reqId, roomId, you, players: { p1: room.p1, p2: room.p2 }, state: room.state });
    }

    if (body.action === "leave") {
      const room = await loadRoom(body.roomId);
      if (room.p1?.userId === body.userId) { room.p1 = null; if (isLobby(room.state)) room.state.ready.p1 = false; }
      if (room.p2?.userId === body.userId) { room.p2 = null; if (isLobby(room.state)) room.state.ready.p2 = false; }
      await saveRoom(room);
      return NextResponse.json({ ok: true, reqId });
    }

    if (body.action === "players") {
      const room = await loadRoom(body.roomId);
      return NextResponse.json({ ok: true, reqId, players: { p1: room.p1, p2: room.p2 } });
    }

    if (body.action === "state") {
      const room = await loadRoom(body.roomId);
      return NextResponse.json({ ok: true, reqId, state: room.state, players: { p1: room.p1, p2: room.p2 } });
    }

    if (body.action === "ready") {
      const room = await loadRoom(body.roomId);
      if (!isLobby(room.state)) {
        return NextResponse.json({ ok: true, reqId, full: true, state: room.state });
      }
      const side: Side | undefined =
        body.side ?? (room.p1?.userId ? "p2" : "p1");
      if (!side) return NextResponse.json({ ok: false, reqId, error: "SIDE_REQUIRED" }, { status: 400 });

      room.state.ready[side] = true;

      if (room.p1 && room.p2 && room.state.ready.p1 && room.state.ready.p2) {
        room.state = startPlayFromLobby(room.state);
      }
      await saveRoom(room);
      const full = room.state.phase === "play";
      return NextResponse.json({
        ok: true,
        reqId,
        full,
        state: room.state,
        patch: full ? undefined : { ready: (room.state as LobbyState).ready },
      });
    }

    if (body.action === "action") {
      const room = await loadRoom(body.roomId);
      const res = applyAction(room.state, body.side, body.payload);
      if (!res.ok) return NextResponse.json({ ...res, reqId }, { status: 400 });
      if (res.patch && room.state.phase === "play") Object.assign(room.state, res.patch);
      await saveRoom(room);
      return NextResponse.json({ ok: true, reqId, patch: res.patch ?? null, winner: res.winner ?? null });
    }

    return NextResponse.json({ ok: false, reqId, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (ex: unknown) {
    const ms = Date.now() - t0;
    const err = ex as Error;
    console.error(`[api/game][${reqId}] ERROR after ${ms}ms:`, err.stack || err.message || String(ex));
    const msg = err instanceof Error ? err.message : "SERVER_ERROR";
    return NextResponse.json({ ok: false, reqId, error: msg }, { status: 500 });
  }
}
