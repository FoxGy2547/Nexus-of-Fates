import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2/promise";

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
type Room = { id: string; seed: string; p1?: PlayerInfo; p2?: PlayerInfo; state: RoomState; updatedAt?: number };

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
      payload:
        | { kind: "playCard"; index: number }
        | { kind: "attack"; index: number }
        | { kind: "endTurn" }
        | { kind: "endPhase" }
        | Record<string, unknown>;
    };

/* ===================== Store (MySQL / Memory) ===================== */

const hasDbEnv = !!process.env.DB_HOST && !!process.env.DB_USER && !!process.env.DB_NAME;

const CREATE_ROOMS_SQL = `
CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(12) PRIMARY KEY,
  seed VARCHAR(64) NOT NULL,
  p1 LONGTEXT NULL,
  p2 LONGTEXT NULL,
  state LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

type Store = {
  get(id: string): Promise<Room | null>;
  upsert(room: Room): Promise<void>;
  remove(id: string): Promise<void>;
};

function safeStringify(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  try { return JSON.stringify(v); } catch { return null; }
}
function parseJSON<T>(s: string | null | undefined): T | undefined {
  if (!s) return undefined;
  try { return JSON.parse(s) as T; } catch { return undefined; }
}

class MySQLStore implements Store {
  private ensured = false;

  private async ensureSchema() {
    if (this.ensured) return;
    const pool = getPool();
    await pool.query(CREATE_ROOMS_SQL);
    await pool.query(`ALTER TABLE rooms ADD INDEX idx_updated_at (updated_at)`).catch(() => {});
    this.ensured = true;
  }

  async get(id: string): Promise<Room | null> {
    await this.ensureSchema();
    const pool = getPool();

    type RoomRow = RowDataPacket & {
      id: string;
      seed: string;
      p1: string | null;
      p2: string | null;
      state: string;
      updatedAt: number | null;
    };

    const [rows] = await pool.query<RoomRow[]>(
      `SELECT id, seed, p1, p2, state, UNIX_TIMESTAMP(updated_at)*1000 AS updatedAt
       FROM rooms WHERE id=? LIMIT 1`,
      [id]
    );
    if (!rows || rows.length === 0) return null;

    const r = rows[0];
    return {
      id: r.id,
      seed: r.seed,
      p1: parseJSON<PlayerInfo>(r.p1),
      p2: parseJSON<PlayerInfo>(r.p2),
      state: parseJSON<RoomState>(r.state) ?? { phase: "lobby", ready: { p1: false, p2: false }, rngSeed: r.seed, lastAction: null },
      updatedAt: r.updatedAt ?? Date.now(),
    };
  }

  async upsert(room: Room): Promise<void> {
    await this.ensureSchema();
    const pool = getPool();

    const p1 = safeStringify(room.p1);
    const p2 = safeStringify(room.p2);
    const state = safeStringify(room.state) ?? "{}";

    await pool.query(
      `INSERT INTO rooms (id, seed, p1, p2, state, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         seed=VALUES(seed),
         p1=VALUES(p1),
         p2=VALUES(p2),
         state=VALUES(state),
         updated_at=CURRENT_TIMESTAMP`,
      [room.id, room.seed, p1, p2, state]
    );
  }

  async remove(id: string): Promise<void> {
    await this.ensureSchema();
    const pool = getPool();
    await pool.query(`DELETE FROM rooms WHERE id=?`, [id]);
  }
}

const memoryRooms = new Map<string, Room>();
class MemoryStore implements Store {
  async get(id: string): Promise<Room | null> { return memoryRooms.get(id) ?? null; }
  async upsert(room: Room): Promise<void> { memoryRooms.set(room.id, { ...room, updatedAt: Date.now() }); }
  async remove(id: string): Promise<void> { memoryRooms.delete(id); }
}

const store: Store = hasDbEnv ? new MySQLStore() : new MemoryStore();

/* ===== purge แบบไม่ต้อง SET GLOBAL ===== */
let lastPurge = 0;
const PURGE_EVERY_MS = 5 * 60 * 1000;
async function maybePurgeOldRooms() {
  if (!hasDbEnv) return;
  const now = Date.now();
  if (now - lastPurge < PURGE_EVERY_MS) return;
  lastPurge = now;
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL 12 HOUR`);
  } catch { /* ignore */ }
}

/* ===================== RNG / utils ===================== */
function hashToSeed(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], seed: string) {
  const rng = mulberry32(hashToSeed(seed));
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
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
  for (let i = 0; i < n; i++) d[ELEMENTS[Math.floor(rng() * ELEMENTS.length)]] += 1;
  return d;
}

/* ===================== Card stats (no any) ===================== */
type CardStat = { atk: number; hp: number; element: Element; ability?: string; cost: number };

declare global {
  var __NOF_CARD_STATS__: Record<string, CardStat> | undefined;
}

let CARD_STATS: Record<string, CardStat> =
  globalThis.__NOF_CARD_STATS__ ?? (globalThis.__NOF_CARD_STATS__ = {} as Record<string, CardStat>);

if (!Object.keys(CARD_STATS).length) {
  const f = (e: Element, atk: number, hp: number, cost: number): CardStat => ({ element: e, atk, hp, cost });
  CARD_STATS = {
    BLAZE_KNIGHT: f("Pyro", 5, 4, 3),
    FROST_ARCHER: f("Cryo", 3, 3, 2),
    THUNDER_COLOSSUS: f("Electro", 6, 7, 4),
    WINDBLADE_DUELIST: f("Anemo", 3, 2, 1),
    STONE_BULWARK: f("Geo", 2, 6, 2),
    TIDE_MAGE: f("Hydro", 2, 4, 2),
    VOID_SEER: f("Quantum", 4, 3, 3),
    MINDSHAPER: f("Imaginary", 3, 3, 3),
    NEXUS_ADEPT: f("Neutral", 2, 2, 1),
    ICE_WARDEN: f("Cryo", 4, 5, 3),
    CINDER_SCOUT: f("Pyro", 3, 2, 1),
    WAVECALLER: f("Hydro", 2, 5, 2),
  };
  globalThis.__NOF_CARD_STATS__ = CARD_STATS;
}

/* ===================== Room helpers ===================== */
function newLobby(seed: string): LobbyState {
  return { phase: "lobby", ready: { p1: false, p2: false }, rngSeed: seed, lastAction: null };
}
async function loadOrCreateRoom(roomId?: string) {
  const id = (roomId || randomUUID().slice(0, 6)).toUpperCase();
  let room = await store.get(id);
  if (!room) {
    const seed = randomUUID();
    room = { id, seed, state: newLobby(seed), updatedAt: Date.now() };
    await store.upsert(room);
  }
  return { id, room: room! };
}
function isLobby(st: RoomState): st is LobbyState { return st.phase === "lobby"; }
function isPlay(st: RoomState): st is BattleState { return st.phase === "play"; }

function sanitize(room: Room) {
  if (!room.state || !("phase" in room.state)) room.state = newLobby(room.seed);
  if (room.p1 && !room.p1.userId) room.p1 = undefined;
  if (room.p2 && !room.p2.userId) room.p2 = undefined;
  if (room.p1?.userId && room.p2?.userId && room.p1.userId === room.p2.userId) {
    room.p2 = undefined; if (isLobby(room.state)) room.state.ready.p2 = false;
  }
  room.updatedAt = Date.now();
}
function forceSitP1(room: Room, user: PlayerInfo) {
  sanitize(room);
  room.p1 = { ...user };
  if (room.p2?.userId === user.userId) {
    room.p2 = undefined; if (isLobby(room.state)) room.state.ready.p2 = false;
  }
  room.updatedAt = Date.now();
}

/* ===================== Game flow ===================== */
function startPlayFromLobby(lobby: LobbyState): BattleState {
  const seed = lobby.rngSeed;
  const codes = Object.keys(CARD_STATS);
  const isChar = (c: string) => CARD_STATS[c].atk > 0 && CARD_STATS[c].hp > 0;
  const chars = codes.filter(isChar);
  const others = codes.filter((c) => !isChar(c));
  const pick3 = (suffix: string) => shuffle(chars, `${seed}:${suffix}`).slice(0, 3);
  const mkUnit = (code: string): Unit => { const s = CARD_STATS[code]; return { code, atk: s.atk, hp: s.hp, element: s.element }; };

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
function startTurn(st: BattleState, side: Side) { st.temp[side] = { plusDmg: 0, shieldNext: 0 }; st.playedCount[side] = 0; st.hand[side].push(...st.deck[side].splice(0, 2)); }
function endTurnAndPass(st: BattleState) { const next: Side = st.turn === "p1" ? "p2" : "p1"; st.turn = next; startTurn(st, next); }

function doPlayCard(st: BattleState, side: Side, index: number) {
  const hand = st.hand[side];
  if (index < 0 || index >= hand.length) return { ok: false, error: "Invalid hand index" } as const;
  const code = hand[index]!;
  const cs = CARD_STATS[code as keyof typeof CARD_STATS];
  if (!cs) return { ok: false, error: "Unknown card" } as const;
  const need = cs.cost ?? 0;
  const el = cs.element;
  if ((st.dice[side][el] ?? 0) < need) return { ok: false, error: "Not enough dice" } as const;

  st.dice[side][el] -= need;
  hand.splice(index, 1);

  if (cs.atk > 0 && cs.hp > 0) {
    const hp = cs.hp + st.temp[side].shieldNext; st.temp[side].shieldNext = 0;
    st.board[side].push({ code, atk: cs.atk, hp, element: el });
  } else {
    st.temp[side].plusDmg += 1;
  }
  st.playedCount[side] += 1;
  st.lastAction = { kind: "playCard", side, code };
  return { ok: true, patch: { hand: st.hand, board: st.board, dice: st.dice, lastAction: st.lastAction } } as const;
}
function doAttack(st: BattleState, side: Side, idx: number) {
  const me = st.board[side]; if (idx < 0 || idx >= me.length) return { ok: false, error: "Invalid board index" } as const;
  const unit = me[idx]!;
  const foeSide: Side = side === "p1" ? "p2" : "p1";
  const foe = st.board[foeSide];
  const dmg = unit.atk + st.temp[side].plusDmg + (unit.code === "BLAZE_KNIGHT" ? 1 : 0);

  if (foe.length > 0) {
    const t = foe[0]!; t.hp -= dmg; unit.hp -= t.atk;
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

    // จั่วการ์ดใหม่ให้ทั้งสองฝั่ง — อย่าใช้ p1/p2 แบบตัวแปร
    (["p1", "p2"] as const).forEach(s => {
      st.hand[s].push(...st.deck[s].splice(0, 4));
    });
  }

  return {
    ok: true,
    patch: { lastAction: st.lastAction, dice: st.dice, hand: st.hand, turn: st.turn }
  } as const;
}

type ApplyOk = { ok: true; patch?: Partial<BattleState> | null; winner?: Side | null };
type ApplyErr = { ok: false; error: string };
type ApplyRes = ApplyOk | ApplyErr;

function applyAction(state: RoomState, side: Side, payload: unknown): ApplyRes {
  if (state.phase !== "play") return { ok: false, error: "Game not started" };
  const st = state as BattleState;

  if (typeof payload === "object" && payload !== null && (payload as Record<string, unknown>).kind === "endPhase") {
    return doEndPhase(st, side);
  }
  if (st.turn !== side) return { ok: false, error: "Not your turn" };

  const p = payload as Record<string, unknown>;
  if (p.kind === "playCard") return doPlayCard(st, side, Number(p.index ?? -1));
  if (p.kind === "attack") return doAttack(st, side, Number(p.index ?? -1));
  if (p.kind === "endTurn") { endTurnAndPass(st); st.lastAction = { kind: "endTurn" }; return { ok: true, patch: { turn: st.turn, lastAction: st.lastAction, hand: st.hand } }; }
  return { ok: true, patch: { lastAction: payload as unknown } };
}

/* ===================== Route handlers ===================== */
export function GET() { return NextResponse.json({ ok: true, route: "game" }); }
function hasActionField(v: unknown): v is { action: Body["action"] } {
  return typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).action === "string";
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    if (!hasActionField(raw)) return NextResponse.json({ ok: false, error: "BAD_BODY" }, { status: 400 });
    const body = raw as Body;

    if (body.action === "createRoom") {
      const { id, room } = await loadOrCreateRoom(body.roomId);
      forceSitP1(room, body.user);
      await store.upsert(room);
      if (Math.random() < 0.02) await maybePurgeOldRooms();
      return NextResponse.json({ ok: true, roomId: id, you: "p1" as const, players: { p1: room.p1 ?? null, p2: room.p2 ?? null }, state: room.state });
    }

    if (body.action === "joinRoom") {
      const { id, room } = await loadOrCreateRoom(body.roomId);
      sanitize(room);
      const user = body.user;

      if (room.p1?.userId === user.userId) {
        room.p1 = user; await store.upsert(room);
        if (Math.random() < 0.02) await maybePurgeOldRooms();
        return NextResponse.json({ ok: true, roomId: id, you: "p1", players: { p1: room.p1 ?? null, p2: room.p2 ?? null }, state: room.state });
      }
      if (room.p2?.userId === user.userId) {
        room.p2 = user; await store.upsert(room);
        if (Math.random() < 0.02) await maybePurgeOldRooms();
        return NextResponse.json({ ok: true, roomId: id, you: "p2", players: { p1: room.p1 ?? null, p2: room.p2 ?? null }, state: room.state });
      }
      if (!room.p2) {
        room.p2 = user; await store.upsert(room);
        if (Math.random() < 0.02) await maybePurgeOldRooms();
        return NextResponse.json({ ok: true, roomId: id, you: "p2", players: { p1: room.p1 ?? null, p2: room.p2 ?? null }, state: room.state });
      }
      if (!room.p1) {
        room.p1 = user; await store.upsert(room);
        if (Math.random() < 0.02) await maybePurgeOldRooms();
        return NextResponse.json({ ok: true, roomId: id, you: "p1", players: { p1: room.p1 ?? null, p2: room.p2 ?? null }, state: room.state });
      }

      return NextResponse.json({ ok: false, error: "ROOM_FULL" }, { status: 400 });
    }

    if (body.action === "leave") {
      const r = await store.get(body.roomId);
      if (!r) return NextResponse.json({ ok: true });
      if (r.p1?.userId === body.userId) { r.p1 = undefined; if (isLobby(r.state)) r.state.ready.p1 = false; }
      if (r.p2?.userId === body.userId) { r.p2 = undefined; if (isLobby(r.state)) r.state.ready.p2 = false; }

      if (!r.p1 && !r.p2) {
        await store.remove(r.id);
        if (Math.random() < 0.02) await maybePurgeOldRooms();
        return NextResponse.json({ ok: true, removed: true });
      }
      sanitize(r); await store.upsert(r);
      if (Math.random() < 0.02) await maybePurgeOldRooms();
      return NextResponse.json({ ok: true });
    }

    if (body.action === "players") {
      const { room } = await loadOrCreateRoom(body.roomId);
      sanitize(room);
      if (Math.random() < 0.02) await maybePurgeOldRooms();
      return NextResponse.json({ ok: true, players: { p1: room.p1 ?? null, p2: room.p2 ?? null } });
    }

    if (body.action === "state") {
      const { room } = await loadOrCreateRoom(body.roomId);
      sanitize(room);
      if (Math.random() < 0.02) await maybePurgeOldRooms();
      return NextResponse.json({ ok: true, state: room.state, players: { p1: room.p1 ?? null, p2: room.p2 ?? null } });
    }

    if (body.action === "ready") {
      const { room } = await loadOrCreateRoom(body.roomId);
      sanitize(room);
      if (!isLobby(room.state)) { await store.upsert(room); return NextResponse.json({ ok: true, full: true, state: room.state }); }

      const side: Side | undefined =
        body.side ??
        (room.p1?.userId === body.userId ? "p1" : room.p2?.userId === body.userId ? "p2" : undefined);
      if (!side) return NextResponse.json({ ok: false, error: "SIDE_REQUIRED" }, { status: 400 });

      room.state.ready[side] = true;
      if (room.p1 && room.p2 && room.state.ready.p1 && room.state.ready.p2) room.state = startPlayFromLobby(room.state);

      await store.upsert(room);
      const full = room.state.phase === "play";
      if (Math.random() < 0.02) await maybePurgeOldRooms();
      return NextResponse.json({ ok: true, full, state: room.state, patch: full ? undefined : { ready: (room.state as LobbyState).ready } });
    }

    if (body.action === "action") {
      const r = await store.get(body.roomId);
      if (!r) return NextResponse.json({ ok: false, error: "ROOM_NOT_FOUND" }, { status: 404 });

      const res = applyAction(r.state, body.side, body.payload);
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      if (res.patch && isPlay(r.state)) Object.assign(r.state, res.patch);

      if (res.winner) {
        await store.remove(r.id);
        if (Math.random() < 0.02) await maybePurgeOldRooms();
        return NextResponse.json({ ok: true, winner: res.winner, removed: true });
      }

      await store.upsert(r);
      if (Math.random() < 0.02) await maybePurgeOldRooms();
      return NextResponse.json({ ok: true, patch: res.patch ?? null, winner: res.winner ?? null });
    }

    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "SERVER_ERROR";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
