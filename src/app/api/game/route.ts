// src/app/api/game/route.ts
import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import cardsDataJson from "@/data/cards.json";

/* ========================= Cards types & helpers ========================= */

type CharacterCard = {
  char_id: number;
  code: string;
  name: string;
  element: string;
  attack: number;
  hp: number;
  cost: number;
  abilityCode: string;
  art: string;
};
type SupportCard = {
  id: number;
  code: string;
  name: string;
  element: string;
  cost: number;
  text: string;
  art: string;
};
type EventCard = {
  id: number;
  code: string;
  name: string;
  element: string;
  cost: number;
  text: string;
  art: string;
};
type CardsData = {
  characters: CharacterCard[];
  supports: SupportCard[];
  events: EventCard[];
};
const cardsData = cardsDataJson as CardsData;

/* ========================= DB ========================= */

function buildPool(): mysql.Pool | null {
  const {
    MYSQL_HOST,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE,
    MYSQL_PORT,
    DB_HOST,
    DB_USER,
    DB_PASS,
    DB_NAME,
    DB_PORT,
    DATABASE_URL,
  } = process.env as Record<string, string | undefined>;

  if (DATABASE_URL) {
    return mysql.createPool({
      uri: DATABASE_URL,
      waitForConnections: true,
      connectionLimit: 10,
    });
  }

  const host = MYSQL_HOST ?? DB_HOST;
  const user = MYSQL_USER ?? DB_USER;
  const password = MYSQL_PASSWORD ?? DB_PASS;
  const database = MYSQL_DATABASE ?? DB_NAME;
  const port = Number(MYSQL_PORT ?? DB_PORT ?? 3306);

  if (!host || !user || !database) return null;

  return mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    waitForConnections: true,
    connectionLimit: 10,
  });
}

// singleton pool (dev hot-reload safety)
const gPool = globalThis as typeof globalThis & {
  __NOF_POOL__?: mysql.Pool | null;
};
if (!gPool.__NOF_POOL__) {
  try {
    gPool.__NOF_POOL__ = buildPool();
  } catch {
    gPool.__NOF_POOL__ = null;
  }
}
const pool: mysql.Pool | null = gPool.__NOF_POOL__;
const DB_ON = !!pool;

/** query one (typed, no any) */
async function qOne<T>(
  sql: string,
  params: (string | number | null | undefined)[] = [],
): Promise<T | null> {
  if (!pool) return null;
  const [rows] = await pool.query<mysql.RowDataPacket[]>(sql, params);
  const first = rows[0] as unknown as T | undefined;
  return first ?? null;
}

/* ========================= Types & Room ========================= */

type Side = "p1" | "p2";
type DicePool = Record<string, number>;
type UnitVM = {
  code: string;
  element: string;
  attack: number;
  hp: number;
  gauge?: number;
};
type PlayerInfo = { userId: string; name?: string | null; avatar?: string | null };

type RoomState = {
  id: string;
  mode: "lobby" | "play";
  players: Partial<Record<Side, PlayerInfo>>;
  ready: Record<Side, boolean>;

  coin: { decided: boolean; winner?: Side };
  coinAck: Record<Side, boolean>;

  phaseNo: number;
  turn: Side;
  phaseActor: Side;
  endTurned: Record<Side, boolean>;
  phaseEndOrder: Side[];

  hero: Record<Side, number>;
  board: Record<Side, UnitVM[]>;
  hand: Record<Side, string[]>;
  deck: Record<Side, string[]>;
  dice: Record<Side, DicePool>;

  warnNoDeck?: string[];
};

// in-memory store rooms (singleton)
const gStore = globalThis as typeof globalThis & {
  __NOF_STORE__?: { rooms: Map<string, RoomState> };
};
if (!gStore.__NOF_STORE__) gStore.__NOF_STORE__ = { rooms: new Map<string, RoomState>() };
const store = gStore.__NOF_STORE__!;

function ensureRoom(id: string): RoomState {
  let r = store.rooms.get(id);
  if (!r) {
    r = {
      id,
      mode: "lobby",
      players: {},
      ready: { p1: false, p2: false },
      coin: { decided: false },
      coinAck: { p1: false, p2: false },
      phaseNo: 0,
      turn: "p1",
      phaseActor: "p1",
      endTurned: { p1: false, p2: false },
      phaseEndOrder: [],
      hero: { p1: 30, p2: 30 },
      board: { p1: [], p2: [] },
      hand: { p1: [], p2: [] },
      deck: { p1: [], p2: [] },
      dice: { p1: {}, p2: {} },
    };
    store.rooms.set(id, r);
  }
  return r;
}

function sideOf(room: RoomState, userId: string): Side | null {
  if (room.players.p1?.userId === userId) return "p1";
  if (room.players.p2?.userId === userId) return "p2";
  return null;
}

/* ========================= Cards helpers ========================= */

const ELEMENTS = [
  "Pyro",
  "Hydro",
  "Cryo",
  "Electro",
  "Geo",
  "Anemo",
  "Quantum",
  "Imaginary",
  "Neutral",
  "Infinite",
] as const;
type ElementKind = (typeof ELEMENTS)[number];

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const allChars = (): CharacterCard[] => cardsData.characters ?? [];
const allSupports = (): SupportCard[] => cardsData.supports ?? [];
const allEvents = (): EventCard[] => cardsData.events ?? [];

function toUnit(code: string): UnitVM | null {
  const ch = allChars().find((c) => c.code === code);
  if (!ch) return null;
  return { code: ch.code, element: ch.element, attack: ch.attack, hp: ch.hp, gauge: 0 };
}

function draw(room: RoomState, side: Side, n: number) {
  for (let i = 0; i < n; i++) {
    const code = room.deck[side].shift();
    if (!code) break;
    room.hand[side].push(code);
  }
}

function addDie(poolD: DicePool, el: ElementKind, n = 1) {
  poolD[el] = (poolD[el] ?? 0) + n;
}
function spendAny(poolD: DicePool, n: number): boolean {
  const total = Object.values(poolD).reduce((a, b) => a + (b ?? 0), 0);
  if (total < n) return false;
  while (n-- > 0) {
    if ((poolD.Infinite ?? 0) > 0) {
      poolD.Infinite--;
      continue;
    }
    const keys = Object.keys(poolD) as ElementKind[];
    const k = keys.find((key) => (poolD[key] ?? 0) > 0);
    if (!k) return false;
    poolD[k] = (poolD[k] ?? 0) - 1;
  }
  return true;
}
function spendElement(poolD: DicePool, el: ElementKind, n: number): boolean {
  const have = (poolD[el] ?? 0) + (poolD.Infinite ?? 0);
  if (have < n) return false;
  const useEl = Math.min(poolD[el] ?? 0, n);
  poolD[el] = (poolD[el] ?? 0) - useEl;
  const remain = n - useEl;
  if (remain > 0) poolD.Infinite = (poolD.Infinite ?? 0) - remain;
  return true;
}

/* ========================= DB: users/decks ========================= */

type UserRow = { id: number; username?: string | null };

async function findUserRowByAny(key: string, display?: string | null): Promise<UserRow | null> {
  if (!DB_ON || !pool) return null;

  if (/^\d{6,}$/.test(key)) {
    const u = await qOne<UserRow>("SELECT id, username FROM users WHERE discord_id = ? LIMIT 1", [key]);
    if (u) return u;
  }
  if (/@/.test(key)) {
    const u = await qOne<UserRow>("SELECT id, username FROM users WHERE email = ? LIMIT 1", [key]);
    if (u) return u;
  }
  const name = display ?? key;
  const u = await qOne<UserRow>("SELECT id, username FROM users WHERE username = ? LIMIT 1", [name]);
  return u ?? null;
}

type DeckRow = {
  id: number;
  user_id: number;
  name: string | null;
  card_char1?: number | null;
  card_char2?: number | null;
  card_char3?: number | null;
  [k: `card${number}`]: number | null | undefined; // card1..card20
};

// โหลดตัวละคร 3 ใบแรก และเด็ค 20 ใบ (supports/events)
async function loadDeckFromDB(userId: number): Promise<{ chars: string[]; deck: string[] } | null> {
  const row = await qOne<DeckRow>("SELECT * FROM decks WHERE user_id = ? LIMIT 1", [userId]);
  if (!row) return null;

  const charIdToCode = new Map<number, string>();
  for (const ch of allChars()) charIdToCode.set(Number(ch.char_id), String(ch.code));

  const chars = [row.card_char1, row.card_char2, row.card_char3]
    .map((id) => (id ? charIdToCode.get(Number(id)) : null))
    .filter((x): x is string => !!x);

  const supById = new Map<number, string>();
  for (const s of allSupports()) supById.set(Number(s.id), String(s.code));
  const evtById = new Map<number, string>();
  for (const e of allEvents()) evtById.set(Number(e.id), String(e.code));

  const deck: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const val = row[`card${i}`];
    if (val == null) continue;
    const id = Number(val);
    const code = supById.get(id) ?? evtById.get(id) ?? null;
    if (code) deck.push(code);
  }

  return { chars, deck: shuffle(deck) };
}

/* ========================= Start game ========================= */

async function startGame(room: RoomState) {
  room.mode = "play";
  room.phaseNo = 1;
  room.endTurned = { p1: false, p2: false };
  room.phaseEndOrder = [];

  const setup = async (side: Side) => {
    room.board[side] = [];
    room.hand[side] = [];
    room.deck[side] = [];

    const p = room.players[side];
    let boardCodes: string[] = [];
    let deckCodes: string[] = [];

    if (p) {
      const u = await findUserRowByAny(p.userId, p.name ?? null);
      if (u) {
        const fromDb = await loadDeckFromDB(u.id);
        if (fromDb) {
          boardCodes = fromDb.chars.slice(0, 3);
          deckCodes = fromDb.deck.slice();
        }
      }
    }

    if (!boardCodes.length) {
      const candidates = allChars().map((c) => c.code);
      shuffle(candidates);
      boardCodes = candidates.slice(0, 3);
    }
    if (!deckCodes.length) {
      const supports = allSupports().map((c) => c.code);
      const events = allEvents().map((c) => c.code);
      deckCodes = shuffle([...supports, ...events, ...supports, ...events]);
    }

    room.board[side] = boardCodes.map((c) => toUnit(c)!).filter(Boolean);
    room.deck[side] = deckCodes;
    draw(room, side, 5);
  };

  await Promise.all([setup("p1"), setup("p2")]);

  room.dice.p1 = {};
  room.dice.p2 = {};
  for (let i = 0; i < 10; i++) {
    const el = ELEMENTS[(Math.random() * (ELEMENTS.length - 1)) | 0];
    addDie(room.dice.p1, el);
    addDie(room.dice.p2, el);
  }

  const win: Side = Math.random() < 0.5 ? "p1" : "p2";
  room.coin = { decided: true, winner: win };
  room.coinAck = { p1: false, p2: false };
  room.turn = win;
  room.phaseActor = win;
}

/* ========================= State to client ========================= */

function stateForClient(room: RoomState, currentUserId?: string) {
  const you: Side | null = currentUserId ? sideOf(room, currentUserId) : null;

  return {
    mode: room.mode,
    players: {
      p1: room.players.p1
        ? { name: room.players.p1.name ?? "Host", avatar: room.players.p1.avatar ?? null }
        : undefined,
      p2: room.players.p2
        ? { name: room.players.p2.name ?? "Player", avatar: room.players.p2.avatar ?? null }
        : undefined,
    },
    coin: room.coin,
    coinAck: room.coinAck,
    turn: room.turn,
    phaseNo: room.phaseNo,
    phaseActor: room.phaseActor,
    endTurned: room.endTurned,
    hero: room.hero,
    dice: room.dice,
    board: room.board,
    hand: room.hand,
    ready: room.ready,
    you: you ?? undefined,
  };
}

/* ========================= Deck presence (warn only) ========================= */

async function userHasDeck(
  room: RoomState,
  side: Side,
): Promise<{ has: boolean; display?: string | null }> {
  if (!DB_ON || !pool) return { has: true, display: room.players[side]?.name ?? null };
  const p = room.players[side];
  if (!p) return { has: false, display: null };

  const u = await findUserRowByAny(p.userId, p.name ?? null);
  if (!u) return { has: false, display: p.name ?? null };

  const d = await qOne<{ id: number }>("SELECT id FROM decks WHERE user_id = ? LIMIT 1", [u.id]);
  return { has: !!d, display: p.name ?? null };
}

async function checkMissingDecks(room: RoomState): Promise<string[]> {
  const missing: string[] = [];
  for (const s of ["p1", "p2"] as const) {
    const r = await userHasDeck(room, s);
    if (!r.has) missing.push(r.display ?? (s === "p1" ? "P1" : "P2"));
  }
  return missing;
}

/* ========================= Turn helpers ========================= */

function passTurnAfterCombat(room: RoomState, actor: Side) {
  const foe: Side = actor === "p1" ? "p2" : "p1";
  room.turn = foe;
  room.phaseActor = foe;
}

/* ========================= Ops ========================= */

function createRoom(roomId: string, user: PlayerInfo) {
  const id = roomId.toUpperCase();
  const room = ensureRoom(id);
  if (!room.players.p1 && !room.players.p2) {
    room.players.p1 = user; // host เป็น p1 เสมอ
  }
  return { ok: true, roomId: id };
}

function joinRoom(roomId: string, user: PlayerInfo) {
  const id = roomId.toUpperCase();
  const room = ensureRoom(id);
  const s = sideOf(room, user.userId);
  if (s) {
    room.players[s] = user;
    return { ok: true, roomId: id };
  }
  if (!room.players.p1) {
    room.players.p1 = user;
    return { ok: true, roomId: id };
  }
  if (!room.players.p2) {
    room.players.p2 = user;
    return { ok: true, roomId: id };
  }
  throw new Error("Room is full");
}

function markReady(room: RoomState, userId: string) {
  const s = sideOf(room, userId);
  if (!s) throw new Error("Not in room");
  room.ready[s] = true;
}

function ackCoin(room: RoomState, userId: string) {
  const s = sideOf(room, userId);
  if (!s) return;
  if (!room.coin.decided) return;
  room.coinAck[s] = true;
}

function endTurn(room: RoomState, userId: string) {
  const s = sideOf(room, userId);
  if (!s) throw new Error("Not in room");
  if (room.turn !== s) return;
  room.turn = s === "p1" ? "p2" : "p1";
  room.phaseActor = room.turn;
}

function endPhase(room: RoomState, userId: string) {
  const s = sideOf(room, userId);
  if (!s) throw new Error("Not in room");
  if (room.phaseActor !== s) return;
  if (room.endTurned[s]) return;

  room.endTurned[s] = true;
  if (!room.phaseEndOrder.includes(s)) room.phaseEndOrder.push(s);

  if (!(room.endTurned.p1 && room.endTurned.p2)) {
    room.turn = s === "p1" ? "p2" : "p1";
    room.phaseActor = room.turn;
    return;
  }

  // เปิดเฟสใหม่ (คนที่กด End Phase ก่อนจะได้เริ่มก่อน)
  const starter = room.phaseEndOrder[0] ?? "p1";
  room.phaseNo += 1;
  room.turn = starter;
  room.phaseActor = starter;
  room.endTurned = { p1: false, p2: false };
  room.phaseEndOrder = [];

  // จบเฟสแล้วจั่ว +2
  draw(room, "p1", 2);
  draw(room, "p2", 2);
}

function playCard(room: RoomState, userId: string, handIndex: number) {
  const s = sideOf(room, userId);
  if (!s) throw new Error("Not in room");
  if (room.phaseActor !== s) return;
  const card = room.hand[s][handIndex];
  if (!card) return;

  // ถ้ามี character หลุดมา → ทิ้งเฉย ๆ
  if (allChars().some((c) => c.code === card)) {
    room.hand[s].splice(handIndex, 1);
    return;
  }

  if (card === "HEALING_AMULET") {
    room.hero[s] = Math.min(room.hero[s] + 2, 30);
  } else if (card === "BLAZING_SIGIL") {
    room.board[s].forEach((u) => (u.hp += 2));
  }
  room.hand[s].splice(handIndex, 1);
}

function discardForInfinite(room: RoomState, userId: string, handIndex: number) {
  const s = sideOf(room, userId);
  if (!s) throw new Error("Not in room");
  if (room.phaseActor !== s) return;
  const card = room.hand[s][handIndex];
  if (!card) return;
  room.hand[s].splice(handIndex, 1);
  addDie(room.dice[s], "Infinite", 1);
}

function combat(
  room: RoomState,
  userId: string,
  attackerIndex: number,
  targetIndex: number | null,
  mode: "basic" | "skill" | "ult",
) {
  const s = sideOf(room, userId);
  if (!s) throw new Error("Not in room");
  if (room.phaseActor !== s) return;

  const foe: Side = s === "p1" ? "p2" : "p1";
  const atk = room.board[s][attackerIndex];
  if (!atk) return;

  const poolD = room.dice[s];
  let dmg = atk.attack;
  let did = false;

  if (mode === "basic") {
    if (!spendAny(poolD, 1)) return;
    dmg = atk.attack;
    atk.gauge = Math.min((atk.gauge ?? 0) + 1, 3);
    did = true;
  } else if (mode === "skill") {
    if (!spendElement(poolD, atk.element as ElementKind, 3)) return;
    dmg = atk.attack + 1;
    atk.gauge = Math.min((atk.gauge ?? 0) + 1, 3);
    did = true;
  } else if (mode === "ult") {
    if ((atk.gauge ?? 0) < 3) return;
    if (!spendElement(poolD, atk.element as ElementKind, 5)) return;
    dmg = atk.attack + 3;
    atk.gauge = 0;
    did = true;
  }

  if (!did) return;

  if (room.board[foe].length === 0) {
    room.hero[foe] = Math.max(0, room.hero[foe] - dmg);
  } else {
    const t = targetIndex ?? 0;
    const tgt = room.board[foe][t];
    if (!tgt) return;
    tgt.hp -= dmg;
    if (tgt.hp <= 0) room.board[foe].splice(t, 1);
  }

  // จบเทิร์นเฉพาะการต่อสู้
  passTurnAfterCombat(room, s);
}

/* ========================= HTTP ========================= */

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      roomId?: string;
      userId?: string;
      user?: PlayerInfo;
      index?: number;
      attacker?: number;
      target?: number | null;
      mode?: "basic" | "skill" | "ult";
    };

    const action = String(body?.action || "");
    const roomId = String(body?.roomId || "").toUpperCase();

    const noRoomNeeded = new Set(["hello", "createRoom", "joinRoom"]);
    if (!action) throw new Error("Missing action");
    if (!roomId && !noRoomNeeded.has(action)) throw new Error("Missing roomId");

    if (action === "hello") {
      return NextResponse.json({ ok: true, time: Date.now(), version: 1, db: DB_ON ? "on" : "off" });
    }

    if (action === "createRoom") {
      const res = createRoom(String(body.roomId || "").toUpperCase(), (body.user ?? {}) as PlayerInfo);
      return NextResponse.json(res);
    }
    if (action === "joinRoom") {
      const res = joinRoom(String(body.roomId || "").toUpperCase(), (body.user ?? {}) as PlayerInfo);
      return NextResponse.json(res);
    }

    const room = ensureRoom(roomId);

    switch (action) {
      case "getState": {
        const uid = String(body.userId || "");
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "ready": {
        const uid = String((body.user as PlayerInfo)?.userId || body.userId || "");
        if (!uid) throw new Error("Missing userId");

        markReady(room, uid);

        const missing = await checkMissingDecks(room);
        room.warnNoDeck = missing.length ? missing : undefined;

        if (room.ready.p1 && room.ready.p2 && room.mode !== "play") {
          await startGame(room);
        }

        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "ackCoin": {
        const uid = String((body.user as PlayerInfo)?.userId || body.userId || "");
        if (uid) ackCoin(room, uid);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "endTurn": {
        const uid = String((body.user as PlayerInfo)?.userId || body.userId || "");
        endTurn(room, uid);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "endPhase": {
        const uid = String((body.user as PlayerInfo)?.userId || body.userId || "");
        endPhase(room, uid);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "playCard": {
        const uid = String((body.user as PlayerInfo)?.userId || body.userId || "");
        const handIndex = Number(body.index ?? 0);
        playCard(room, uid, handIndex);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "discardForInfinite": {
        const uid = String((body.user as PlayerInfo)?.userId || body.userId || "");
        const handIndex = Number(body.index ?? 0);
        discardForInfinite(room, uid, handIndex);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "combat": {
        const uid = String((body.user as PlayerInfo)?.userId || body.userId || "");
        const attacker = Number(body.attacker ?? 0);
        const target = body.target == null ? null : Number(body.target);
        const mode = String(body.mode ?? "basic") as "basic" | "skill" | "ult";
        combat(room, uid, attacker, target, mode);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
