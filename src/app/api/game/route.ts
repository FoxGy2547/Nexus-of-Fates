// src/app/api/game/route.ts
import { NextResponse } from "next/server";
import cardsDataJson from "@/data/cards.json";
import { supa } from "@/lib/supabase"; // ใช้ client จาก lib/supabase.ts

export const runtime = "nodejs";

/* ========================= Cards types ========================= */
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

/* ========================= เปิดใช้ DB เมื่อมีค่า Supabase ========================= */
const DB_ON = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/* ========================= Types & Room ========================= */
export type Side = "p1" | "p2";
type DicePool = Record<string, number>;
type UnitVM = { code: string; element: string; attack: number; hp: number; gauge?: number };
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

/* ========================= Local fallback store ========================= */
type GlobalWithStore = typeof globalThis & {
  __NOF_STORE__?: Map<string, { version: number; state: RoomState }>;
};
const gs = globalThis as GlobalWithStore;
if (!gs.__NOF_STORE__) gs.__NOF_STORE__ = new Map();

/* ========================= Persistence (Supabase) ========================= */
type RoomRow = { id: string; version: number; state_json: unknown; updated_at?: string | null };

function freshRoom(id: string): RoomState {
  return {
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
}

async function loadRoom(roomId: string): Promise<{ state: RoomState; version: number }> {
  const id = roomId.toUpperCase();

  if (DB_ON) {
    try {
      const { data } = await supa
        .from("rooms")
        .select("id, version, state_json")
        .eq("id", id)
        .maybeSingle<{ id: string; version: number; state_json: unknown }>();
      if (data) {
        return { state: data.state_json as RoomState, version: Number(data.version) };
      }

      const state = freshRoom(id);
      // insert หากยังไม่มี
      await supa.from("rooms").insert({
        id,
        version: 1,
        state_json: state,
        updated_at: new Date().toISOString(),
      });
      return { state, version: 1 };
    } catch {
      // ถ้า DB พัง ให้ตกไป local
    }
  }

  const local = gs.__NOF_STORE__!.get(id);
  if (local) return { state: local.state, version: local.version };
  const state = freshRoom(id);
  gs.__NOF_STORE__!.set(id, { version: 1, state });
  return { state, version: 1 };
}

async function saveRoom(
  roomId: string,
  nextState: RoomState,
  prevVersion: number,
  retry = 0
): Promise<number> {
  const id = roomId.toUpperCase();

  if (DB_ON) {
    try {
      const { data, error } = await supa
        .from("rooms")
        .update({
          state_json: nextState,
          version: prevVersion + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("version", prevVersion)
        .select("version")
        .maybeSingle<{ version: number }>();

      if (!error && data) return Number(data.version);

      if (retry < 2) {
        const { data: cur } = await supa
          .from("rooms")
          .select("version")
          .eq("id", id)
          .maybeSingle<{ version: number }>();
        const curVer = Number(cur?.version ?? 1);
        return saveRoom(id, nextState, curVer, retry + 1);
      }
      throw new Error("Conflict: room updated concurrently");
    } catch {
      // ตกมาใช้ local ถ้า DB ล้ม
    }
  }

  const cur = gs.__NOF_STORE__!.get(id);
  const curVer = cur?.version ?? 1;
  if (cur && curVer !== prevVersion) {
    if (retry >= 2) throw new Error("Conflict (local)");
    return saveRoom(id, nextState, curVer, retry + 1);
  }
  gs.__NOF_STORE__!.set(id, { version: prevVersion + 1, state: nextState });
  return prevVersion + 1;
}

/* ========================= Helpers ========================= */
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
const allChars = (): CharacterCard[] => cardsData.characters;
const allSupports = (): SupportCard[] => cardsData.supports;
const allEvents = (): EventCard[] => cardsData.events;

function toUnit(code: string): UnitVM | null {
  const ch = allChars().find((c) => c.code === code);
  if (!ch) return null;
  return { code: ch.code, element: ch.element, attack: ch.attack, hp: ch.hp, gauge: 0 };
}
function sideOf(room: RoomState, userId: string): Side | null {
  if (room.players.p1?.userId === userId) return "p1";
  if (room.players.p2?.userId === userId) return "p2";
  return null;
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
  let remain = n;
  const inf = Math.min(poolD.Infinite ?? 0, remain);
  if (inf > 0) {
    poolD.Infinite = (poolD.Infinite ?? 0) - inf;
    remain -= inf;
  }
  while (remain > 0) {
    const k = Object.keys(poolD).find((x) => (poolD[x] ?? 0) > 0) as ElementKind | undefined;
    if (!k) return false;
    poolD[k] = (poolD[k] ?? 0) - 1;
    remain--;
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

/* ========================= DB users/decks (via Supabase) ========================= */
type UserRow = {
  id: number;
  username?: string | null;
  discord_id?: string | null;
  email?: string | null;
};

async function findUserRowByAny(key: string, display?: string | null): Promise<UserRow | null> {
  if (!DB_ON) return null;

  // by discord_id
  if (/^\d{6,}$/.test(key)) {
    const { data } = await supa
      .from("users")
      .select("id, username")
      .eq("discord_id", key)
      .maybeSingle<Pick<UserRow, "id" | "username">>();
    return (data as unknown as UserRow) ?? null;
  }

  // by email
  if (/@/.test(key)) {
    const { data } = await supa
      .from("users")
      .select("id, username")
      .eq("email", key)
      .maybeSingle<Pick<UserRow, "id" | "username">>();
    return (data as unknown as UserRow) ?? null;
  }

  // by username
  const name = display ?? key;
  const { data } = await supa
    .from("users")
    .select("id, username")
    .eq("username", name)
    .maybeSingle<Pick<UserRow, "id" | "username">>();
  return (data as unknown as UserRow) ?? null;
}

type CardIndex =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20;
type DeckDynamic = Record<`card${CardIndex}`, number | null | undefined>;
type DeckRow = {
  id: number;
  user_id: number;
  name: string | null;
  card_char1?: number | null;
  card_char2?: number | null;
  card_char3?: number | null;
} & DeckDynamic;

async function loadDeckFromDB(userId: number): Promise<{ chars: string[]; deck: string[] } | null> {
  if (!DB_ON) return null;
  const { data } = await supa
    .from("decks")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<DeckRow>();

  const row = (data as unknown as DeckRow | null);
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
  for (let i = 1 as CardIndex; i <= 20; i = ((i + 1) as unknown) as CardIndex) {
    const key = `card${i}` as keyof DeckDynamic;
    const val = row[key];
    if (val == null) continue;
    const id = Number(val);
    const code = supById.get(id) ?? evtById.get(id) ?? null;
    if (code) deck.push(code);
  }
  return { chars, deck: shuffle(deck) };
}

/* ========================= Game ops ========================= */
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
    warnNoDeck: room.warnNoDeck,
  };
}

async function userHasDeck(
  room: RoomState,
  side: Side
): Promise<{ has: boolean; display?: string | null }> {
  if (!DB_ON) return { has: true, display: room.players[side]?.name ?? null };
  const p = room.players[side];
  if (!p) return { has: false, display: null };
  const u = await findUserRowByAny(p.userId, p.name ?? null);
  if (!u) return { has: false, display: p.name ?? null };
  const { data } = await supa
    .from("decks")
    .select("id")
    .eq("user_id", u.id)
    .maybeSingle<{ id: number }>();
  return { has: !!data, display: p.name ?? null };
}
async function checkMissingDecks(room: RoomState): Promise<string[]> {
  const missing: string[] = [];
  for (const s of ["p1", "p2"] as const) {
    const r = await userHasDeck(room, s);
    if (!r.has) missing.push(r.display ?? (s === "p1" ? "P1" : "P2"));
  }
  return missing;
}

function createRoomOp(room: RoomState, user: PlayerInfo) {
  if (!room.players.p1 && !room.players.p2) room.players.p1 = user;
}
function joinRoomOp(room: RoomState, user: PlayerInfo) {
  const s = sideOf(room, user.userId);
  if (s) {
    room.players[s] = user;
    return;
  }
  if (!room.players.p1) {
    room.players.p1 = user;
    return;
  }
  if (!room.players.p2) {
    room.players.p2 = user;
    return;
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
  if (room.coinAck.p1 && room.coinAck.p2) room.coin.decided = false;
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

  const starter = room.phaseEndOrder[0] ?? "p1";
  room.phaseNo += 1;
  room.turn = starter;
  room.phaseActor = starter;
  room.endTurned = { p1: false, p2: false };
  room.phaseEndOrder = [];

  draw(room, "p1", 2);
  draw(room, "p2", 2);
}
function playCard(room: RoomState, userId: string, handIndex: number) {
  const s = sideOf(room, userId);
  if (!s) throw new Error("Not in room");
  if (room.phaseActor !== s) return;
  const card = room.hand[s][handIndex];
  if (!card) return;

  if (allChars().some((c) => c.code === card)) {
    room.hand[s].splice(handIndex, 1);
    return;
  }

  if (card === "HEALING_AMULET") {
    room.hero[s] = Math.min(room.hero[s] + 2, 30);
  } else if (card === "BLAZING_SIGIL") {
    room.board[s].forEach((u) => (u.hp += 2));
  } else if (card === "FIREWORKS") {
    const foe: Side = s === "p1" ? "p2" : "p1";
    if (room.board[foe].length === 0) {
      room.hero[foe] = Math.max(0, room.hero[foe] - 2);
    } else {
      for (let i = room.board[foe].length - 1; i >= 0; i--) {
        room.board[foe][i].hp -= 2;
        if (room.board[foe][i].hp <= 0) room.board[foe].splice(i, 1);
      }
    }
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
function passTurnAfterCombat(room: RoomState, actor: Side) {
  const foe: Side = actor === "p1" ? "p2" : "p1";
  room.turn = foe;
  room.phaseActor = foe;
}
function combat(
  room: RoomState,
  userId: string,
  attackerIndex: number,
  targetIndex: number | null,
  mode: "basic" | "skill" | "ult"
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

  passTurnAfterCombat(room, s);
}

/* ========= auto member sync (กันเด้งข้ามอินสแตนซ์แล้วหายจากห้อง) ========= */
function ensureMember(room: RoomState, user?: PlayerInfo) {
  if (!user?.userId) return;
  const s = sideOf(room, user.userId);
  if (!s) {
    try {
      joinRoomOp(room, user);
    } catch {
      /* ห้องเต็มก็ข้ามได้ */
    }
  } else {
    room.players[s] = user; // sync ชื่อ/อวาตาร์
  }
}

/* ========================= tolerant body parser ========================= */
async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      const j = await req.json();
      if (j && typeof j === "object") return j as Record<string, unknown>;
    }
  } catch {}
  try {
    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("application/x-www-form-urlencoded")) {
      const txt = await req.text();
      const p = new URLSearchParams(txt);
      const obj: Record<string, unknown> = {};
      p.forEach((v, k) => (obj[k] = v));
      return obj;
    }
  } catch {}
  try {
    const txt = await req.text();
    if (txt && txt.trim().startsWith("{")) {
      const j = JSON.parse(txt);
      if (j && typeof j === "object") return j as Record<string, unknown>;
    }
  } catch {}
  try {
    const u = new URL(req.url);
    const obj: Record<string, unknown> = {};
    u.searchParams.forEach((v, k) => (obj[k] = v));
    if (Object.keys(obj).length > 0) return obj;
  } catch {}
  return {};
}

/* ========================= HTTP ========================= */
export async function POST(req: Request) {
  try {
    const raw = await parseBody(req);
    const body = raw as {
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
      return NextResponse.json({
        ok: true,
        time: Date.now(),
        version: 1,
        db: DB_ON ? "on" : "off",
      });
    }

    // ไม่บังคับมี user
    if (action === "createRoom") {
      const id = roomId;
      const { state, version } = await loadRoom(id);
      if (body.user?.userId) createRoomOp(state, body.user);
      await saveRoom(id, state, version);
      return NextResponse.json({ ok: true, roomId: id });
    }

    if (action === "joinRoom") {
      const id = roomId;
      const { state, version } = await loadRoom(id);
      if (body.user?.userId) joinRoomOp(state, body.user);
      await saveRoom(id, state, version);
      return NextResponse.json({ ok: true, roomId: id });
    }

    const { state: room, version: ver } = await loadRoom(roomId);

    switch (action) {
      case "getState": {
        const uid = String(body.userId || "");
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "ready": {
        const user = body.user as PlayerInfo | undefined;
        ensureMember(room, user);

        const uid = String(user?.userId || body.userId || "");
        if (!uid) throw new Error("Missing userId");

        markReady(room, uid);
        const missing = await checkMissingDecks(room);
        room.warnNoDeck = missing.length ? missing : undefined;
        if (room.ready.p1 && room.ready.p2 && room.mode !== "play") {
          await startGame(room);
        }
        await saveRoom(roomId, room, ver);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "ackCoin": {
        const user = body.user as PlayerInfo | undefined;
        ensureMember(room, user);

        const uid = String(user?.userId || body.userId || "");
        ackCoin(room, uid);
        await saveRoom(roomId, room, ver);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "endTurn": {
        const user = body.user as PlayerInfo | undefined;
        ensureMember(room, user);

        const uid = String(user?.userId || body.userId || "");
        endTurn(room, uid);
        await saveRoom(roomId, room, ver);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "endPhase": {
        const user = body.user as PlayerInfo | undefined;
        ensureMember(room, user);

        const uid = String(user?.userId || body.userId || "");
        endPhase(room, uid);
        await saveRoom(roomId, room, ver);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "playCard": {
        const user = body.user as PlayerInfo | undefined;
        ensureMember(room, user);

        const uid = String(user?.userId || body.userId || "");
        const handIndex = Number(body.index ?? 0);
        playCard(room, uid, handIndex);
        await saveRoom(roomId, room, ver);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "discardForInfinite": {
        const user = body.user as PlayerInfo | undefined;
        ensureMember(room, user);

        const uid = String(user?.userId || body.userId || "");
        const handIndex = Number(body.index ?? 0);
        discardForInfinite(room, uid, handIndex);
        await saveRoom(roomId, room, ver);
        return NextResponse.json({ ok: true, state: stateForClient(room, uid) });
      }

      case "combat": {
        const user = body.user as PlayerInfo | undefined;
        ensureMember(room, user);

        const uid = String(user?.userId || body.userId || "");
        const attacker = Number(body.attacker ?? 0);
        const target = body.target == null ? null : Number(body.target);
        const mode = String(body.mode ?? "basic") as "basic" | "skill" | "ult";
        combat(room, uid, attacker, target, mode);
        await saveRoom(roomId, room, ver);
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
