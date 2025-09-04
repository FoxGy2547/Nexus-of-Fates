import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===== Types ===== */
type Side = "p1" | "p2";
type Element =
  | "Pyro" | "Hydro" | "Cryo" | "Electro"
  | "Geo" | "Anemo" | "Quantum" | "Imaginary" | "Neutral";

interface PlayerInfo { userId: string; name?: string | null; avatar?: string | null; }

type DicePool = Record<Element, number>;

type Unit = { code: string; atk: number; hp: number; element: Element };

type LastAction =
  | { kind: "draw"; card: string }
  | { kind: "playCard"; side: Side; code: string }
  | { kind: "attackUnit"; side: Side; code: string; target: string; dmg: number; coun: number }
  | { kind: "attackHero"; side: Side; code: string; dmg: number }
  | { kind: "endTurn" }
  | Record<string, unknown> // เผื่อ debug payload อื่น ๆ

type LobbyState = {
  phase: "lobby";
  ready: { p1: boolean; p2: boolean };
  rngSeed: string;
  lastAction: LastAction | null;
};

type BattleState = {
  phase: "play";
  rngSeed: string;
  turn: Side;
  lastAction: LastAction | null;
  hero: { p1: number; p2: number };
  deck: { p1: string[]; p2: string[] };
  hand: { p1: string[]; p2: string[] };
  board: { p1: Unit[]; p2: Unit[] };
  discard: { p1: string[]; p2: string[] };
  dice: { p1: DicePool; p2: DicePool };
  playedCount: { p1: number; p2: number };
  temp: { p1: { plusDmg: number; shieldNext: number }; p2: { plusDmg: number; shieldNext: number } };
};

type RoomState = {
  state: LobbyState | BattleState;
  seed: string;
  p1?: PlayerInfo;
  p2?: PlayerInfo;
};

type ActionOk  = { ok: true; patch?: Partial<BattleState>; winner?: Side };
type ActionErr = { ok: false; error: string };
type ActionRes = ActionOk | ActionErr;

type CreateRoomBody = { action: "createRoom"; roomId?: string; user: PlayerInfo };
type JoinRoomBody   = { action: "joinRoom"; roomId: string; user: PlayerInfo };
type PlayersBody    = { action: "players"; roomId: string };
type ReadyBody      = { action: "ready"; roomId: string; side?: Side; userId?: string };
type StateBody      = { action: "state"; roomId: string };
type LeaveBody      = { action: "leave"; roomId: string; userId: string };
type ActionPayload  =
  | { kind: "playCard"; index: number }
  | { kind: "attack"; index: number }
  | { kind: "endTurn" }
  | Record<string, unknown>;
type ActionBody     = { action: "action"; roomId: string; side: Side; payload: ActionPayload };

type Body = CreateRoomBody | JoinRoomBody | PlayersBody | ReadyBody | StateBody | ActionBody | LeaveBody;

/* ===== Global stores ===== */
declare global {
  // eslint-disable-next-line no-var
  var __NOF_ROOMS__: Map<string, RoomState> | undefined;
  // eslint-disable-next-line no-var
  var __NOF_CARD_STATS__:
    | Record<string, { atk: number; hp: number; element: Element; ability?: string; cost: number }>
    | undefined;
}
const rooms = globalThis.__NOF_ROOMS__ ?? new Map<string, RoomState>();
globalThis.__NOF_ROOMS__ = rooms;

let CARD_STATS =
  globalThis.__NOF_CARD_STATS__ ??
  (globalThis.__NOF_CARD_STATS__ = {} as Record<
    string,
    { atk: number; hp: number; element: Element; ability?: string; cost: number }
  >);

/* ===== RNG / utils ===== */
function hashToSeed(s: string) { let h = 2166136261 >>> 0; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619);} return h>>>0; }
function mulberry32(a: number){ return function(){ let t=(a+=0x6D2B79F5); t=Math.imul(t^(t>>>15), t|1); t^=t+Math.imul(t^(t>>>7), t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function shuffle<T>(arr:T[], seed:string){ const rng=mulberry32(hashToSeed(seed)); const a=arr.slice(); for(let i=a.length-1;i>0;i++){const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }

/* ===== Dice ===== */
const ELEMENTS: Element[] = ["Pyro","Hydro","Cryo","Electro","Geo","Anemo","Quantum","Imaginary","Neutral"];
function emptyDice(): DicePool { const d = {} as DicePool; ELEMENTS.forEach(e=> (d[e]=0)); return d; }
function rollDice(seed:string){ const rng=mulberry32(hashToSeed(seed)); const d=emptyDice(); for(let i=0;i<6;i++){ const e=ELEMENTS[Math.floor(rng()*ELEMENTS.length)]; d[e]+=1; } return d; }

/* ===== Cards (DB or fallback) ===== */
async function ensureCardStatsLoaded() {
  if (Object.keys(CARD_STATS).length) return;
  try {
    const pool = getPool();
    if (!pool) throw new Error("no-db");
    const [rows] = await pool.query<any[]>(
      "SELECT code, element, attack AS atk, hp, ability, cost FROM cards"
    );
    for (const r of rows) {
      if (!r.code) continue;
      CARD_STATS[r.code] = {
        atk: r.atk ?? 1, hp: r.hp ?? 1,
        element: (r.element ?? "Neutral") as Element,
        ability: r.ability ?? undefined, cost: r.cost ?? 0,
      };
    }
    if (!Object.keys(CARD_STATS).length) throw new Error("empty-cards");
  } catch {
    const f = (e: Element, atk:number, hp:number, cost:number) => ({ element:e, atk, hp, cost });
    CARD_STATS = {
      BLAZE_KNIGHT:f("Pyro",5,4,3), FROST_ARCHER:f("Cryo",3,3,2),
      THUNDER_COLOSSUS:f("Electro",6,7,4), WINDBLADE_DUELIST:f("Anemo",3,2,1),
      STONE_BULWARK:f("Geo",2,6,2), TIDE_MAGE:f("Hydro",2,4,2),
      VOID_SEER:f("Quantum",4,3,3), MINDSHAPER:f("Imaginary",3,3,3),
      NEXUS_ADEPT:f("Neutral",2,2,1), ICE_WARDEN:f("Cryo",4,5,3),
      CINDER_SCOUT:f("Pyro",3,2,1), WAVECALLER:f("Hydro",2,5,2),
    };
    globalThis.__NOF_CARD_STATS__ = CARD_STATS;
  }
}

/* ===== Lobby / start / turn ===== */
function newLobbyState(seed:string): LobbyState {
  return { phase:"lobby", ready:{p1:false,p2:false}, rngSeed:seed, lastAction:null };
}

function startPlay(state: LobbyState): BattleState {
  const seed = state.rngSeed;
  const allCodes = Object.keys(CARD_STATS);
  const d1 = shuffle(allCodes, seed + ":p1");
  const d2 = shuffle(allCodes, seed + ":p2");
  const drawN = (d:string[], n:number)=> d.splice(0,n);
  const st: BattleState = {
    phase:"play", rngSeed:seed, turn:"p1", lastAction:null,
    hero:{p1:30,p2:30}, deck:{p1:d1,p2:d2},
    hand:{p1:drawN(d1,4), p2:drawN(d2,4)},
    board:{p1:[],p2:[]}, discard:{p1:[],p2:[]},
    dice:{p1:rollDice(seed+":roll:p1:0"), p2:emptyDice()},
    playedCount:{p1:0,p2:0}, temp:{p1:{plusDmg:0,shieldNext:0}, p2:{plusDmg:0,shieldNext:0}},
  };
  return st;
}
function drawOne(state:BattleState, side:Side){ const d=state.deck[side]; if(!d.length) return; const c=d.shift()!; state.hand[side].push(c); state.lastAction={kind:"draw", card:c}; }
function startTurn(state:BattleState, side:Side){ state.temp[side]={plusDmg:0,shieldNext:0}; state.dice[side]=rollDice(state.rngSeed+":roll:"+side+":"+Date.now()); state.playedCount[side]=0; }
function endTurnAndPass(state:BattleState){ const next:Side=state.turn==="p1"?"p2":"p1"; state.turn=next; startTurn(state,next); }

/* ===== Abilities ===== */
function onPlayAbility(s:BattleState, side:Side, unit:Unit){
  if (unit.code==="STONE_BULWARK") s.temp[side].shieldNext += 2;
  if (unit.code==="TIDE_MAGE") s.hero[side] = Math.min(30, s.hero[side]+2);
  if (unit.code==="VOID_SEER") s.temp[side].plusDmg += 1;
  if (unit.code==="NEXUS_ADEPT" && s.playedCount[side]===1) drawOne(s, side);
}

/* ===== Actions ===== */
function doPlayCard(s:BattleState, side:Side, handIndex:number):ActionRes{
  const hand=s.hand[side];
  if (handIndex<0 || handIndex>=hand.length) return { ok:false, error:"Invalid hand index" };
  const code=hand[handIndex]; const stat=CARD_STATS[code]; if(!stat) return { ok:false, error:"Unknown card" };
  const need=stat.cost??0; if (s.dice[side][stat.element]<need) return { ok:false, error:"Not enough dice" };
  s.dice[side][stat.element]-=need; hand.splice(handIndex,1);
  const hp=stat.hp+(s.temp[side].shieldNext||0); if (s.temp[side].shieldNext>0) s.temp[side].shieldNext=0;
  const u:Unit={ code, atk:stat.atk, hp, element:stat.element }; s.board[side].push(u); s.playedCount[side]+=1;
  onPlayAbility(s, side, u); s.lastAction={ kind:"playCard", side, code };
  return { ok:true, patch:{ hand:s.hand, board:s.board, dice:s.dice, lastAction:s.lastAction } };
}
function doAttack(s:BattleState, side:Side, boardIndex:number):ActionRes{
  const me=s.board[side]; if (boardIndex<0 || boardIndex>=me.length) return { ok:false, error:"Invalid board index" };
  const unit=me[boardIndex]; const enemy:Side=side==="p1"?"p2":"p1"; const foe=s.board[enemy];
  const dmg = unit.atk + (s.temp[side].plusDmg || 0);
  const blazeBonus=unit.code==="BLAZE_KNIGHT"?1:0;
  if (foe.length>0){
    const target=foe[0]; target.hp-=dmg; unit.hp-=target.atk;
    s.lastAction={ kind:"attackUnit", side, code:unit.code, target:target.code, dmg, coun:target.atk };
    if (target.hp<=0){ foe.shift(); s.discard[enemy].push(target.code); }
    if (unit.hp<=0){ me.splice(boardIndex,1); s.discard[side].push(unit.code); }
    return { ok:true, patch:{ board:s.board, discard:s.discard, lastAction:s.lastAction } };
  } else {
    s.hero[enemy]=Math.max(0, s.hero[enemy]-(dmg+blazeBonus));
    s.lastAction={ kind:"attackHero", side, code:unit.code, dmg:dmg+blazeBonus };
    if (s.hero[enemy]<=0) return { ok:true, patch:{ hero:s.hero, lastAction:s.lastAction }, winner:side };
    return { ok:true, patch:{ hero:s.hero, lastAction:s.lastAction } };
  }
}
function applyAction(state: LobbyState | BattleState, side:Side, action: ActionPayload):ActionRes{
  if (state.phase!=="play") return { ok:false, error:"Game not started" };
  const s = state as BattleState;
  if (s.turn!==side) return { ok:false, error:"Not your turn" };

  if (action?.kind==="playCard") return doPlayCard(s, side, typeof action.index==="number" ? action.index : -1);
  if (action?.kind==="attack")   return doAttack(s, side, typeof action.index==="number" ? action.index : -1);
  if (action?.kind==="endTurn")  { endTurnAndPass(s); s.lastAction = { kind:"endTurn" }; return { ok:true, patch:{ turn:s.turn, dice:s.dice, lastAction:s.lastAction } }; }
  return { ok:true, patch:{ lastAction: action as LastAction } };
}

/* ===== Helpers (Room) ===== */
function getOrCreateRoom(roomId?: string){
  if (roomId && rooms.has(roomId)) return { id: roomId, room: rooms.get(roomId)! };
  const id = roomId || randomUUID().slice(0,8).toUpperCase();
  if (!rooms.has(id)){ const seed=randomUUID(); rooms.set(id, { seed, state:newLobbyState(seed) }); }
  return { id, room: rooms.get(id)! };
}
const dump = (r: RoomState) => ({
  p1: r.p1?.userId ?? null, p2: r.p2?.userId ?? null,
  ready: (r.state as LobbyState).ready ?? null, phase: r.state?.phase ?? null,
});

// เคลียร์ state ผิดปกติ + กันคนเดิมนั่งสองฝั่ง
function sanitize(room: RoomState) {
  if (!room.state || (room.state as any).ready === undefined) room.state = newLobbyState(room.seed);
  if (room.p1 && !room.p1.userId) room.p1 = undefined;
  if (room.p2 && !room.p2.userId) room.p2 = undefined;
  if (room.p1 && room.p2 && room.p1.userId === room.p2.userId) {
    room.p2 = undefined;
    if (room.state.phase === "lobby") (room.state as LobbyState).ready.p2 = false;
  }
}

/** จัดที่นั่งแบบแข็งแรง: ไม่ยอมให้ user เดิมครองสองที่, เตะ "คนไม่ ready" ออกจาก lobby ได้ */
function attachOrReuse(
  room: RoomState,
  user: PlayerInfo,
  prefer?: Side,
): Side | null {
  sanitize(room);

  // เคยอยู่แล้ว → คืนที่เดิม
  if (room.p1?.userId === user.userId) { room.p1 = user; return "p1"; }
  if (room.p2?.userId === user.userId) { room.p2 = user; return "p2"; }

  // ถ้าเต็มสองฝั่งแล้ว
  if (room.p1 && room.p2) {
    // lobby: เตะคนที่ยังไม่ ready ก่อน
    if (room.state.phase === "lobby") {
      const ready = (room.state as LobbyState).ready;
      if (!ready.p2) { room.p2 = undefined; return attachOrReuse(room, user, "p2"); }
      if (!ready.p1) { room.p1 = undefined; return attachOrReuse(room, user, "p1"); }
    }
    return null; // เต็มจริง
  }

  // เคารพ prefer ก่อน
  if (prefer === "p1" && !room.p1) { room.p1 = user; return "p1"; }
  if (prefer === "p2" && !room.p2) { room.p2 = user; return "p2"; }

  // เลือกที่นั่งว่าง
  if (!room.p1) { room.p1 = user; return "p1"; }
  if (!room.p2) { room.p2 = user; return "p2"; }

  return null;
}

/* ===== Debug GET ===== */
export function GET() {
  return NextResponse.json({ ok: true, route: "game" });
}

/* ===== POST handler ===== */
export async function POST(req: Request) {
  try {
    await ensureCardStatsLoaded();

    let body: Body | null = null;
    try { body = (await req.json()) as Body; } catch { /* ignore bad json */ }
    if (!body || typeof (body as { action?: unknown }).action !== "string") {
      return NextResponse.json({ ok:false, error:"BAD_BODY" }, { status: 400 });
    }

    if (body.action === "createRoom") {
      const { id, room } = getOrCreateRoom(body.roomId);
      const side = attachOrReuse(room, body.user, "p1"); // บังคับจับ p1
      if (!side) return NextResponse.json({ ok:false, error:"ROOM_FULL" }, { status:400 });
      return NextResponse.json({ ok:true, roomId:id, you:side, state:room.state });
    }

    if (body.action === "joinRoom") {
      const { id, room } = getOrCreateRoom(body.roomId);
      console.log("[joinRoom] before", id, dump(room));
      const side = attachOrReuse(room, body.user, undefined);
      console.log("[joinRoom] after ", id, "=>", side, dump(room));
      if (!side) return NextResponse.json({ ok:false, error:"ROOM_FULL" }, { status:400 });
      return NextResponse.json({
        ok:true, roomId:id, you:side,
        players:{ p1: room.p1 || null, p2: room.p2 || null }, state:room.state
      });
    }

    if (body.action === "leave") {
      const r = rooms.get(body.roomId);
      if (!r) return NextResponse.json({ ok:true });
      if (r.p1?.userId === body.userId) { r.p1 = undefined; if (r.state.phase==="lobby") (r.state as LobbyState).ready.p1 = false; }
      if (r.p2?.userId === body.userId) { r.p2 = undefined; if (r.state.phase==="lobby") (r.state as LobbyState).ready.p2 = false; }
      return NextResponse.json({ ok:true });
    }

    if (body.action === "players") {
      const r = rooms.get(body.roomId);
      if (!r) return NextResponse.json({ ok:false, error:"ROOM_NOT_FOUND" }, { status:404 });
      sanitize(r);
      return NextResponse.json({ ok:true, players:{ p1:r.p1||null, p2:r.p2||null } });
    }

    if (body.action === "ready") {
      const r = rooms.get(body.roomId);
      if (!r) return NextResponse.json({ ok:false, error:"ROOM_NOT_FOUND" }, { status:404 });

      // ถ้าเกมเริ่มไปแล้ว → idempotent
      if (r.state.phase !== "lobby") {
        return NextResponse.json({ ok:true, full:true, state:r.state });
      }

      const side = body.side ||
        (r.p1?.userId===body.userId ? "p1" : r.p2?.userId===body.userId ? "p2" : undefined);
      if (!side) return NextResponse.json({ ok:false, error:"SIDE_REQUIRED" }, { status:400 });

      (r.state as LobbyState).ready[side] = true;

      const ready = (r.state as LobbyState).ready;
      if (r.p1 && r.p2 && ready.p1 && ready.p2) {
        r.state = startPlay(r.state as LobbyState);
        return NextResponse.json({ ok:true, full:true, state:r.state });
      }
      return NextResponse.json({ ok:true, full:false, patch:{ ready } });
    }

    if (body.action === "state") {
      const r = rooms.get(body.roomId);
      if (!r) return NextResponse.json({ ok:false, error:"ROOM_NOT_FOUND" }, { status:404 });
      sanitize(r);
      return NextResponse.json({ ok:true, state:r.state, players:{ p1:r.p1||null, p2:r.p2||null } });
    }

    if (body.action === "action") {
      const r = rooms.get(body.roomId);
      if (!r || !r.state) return NextResponse.json({ ok:false, error:"ROOM_NOT_FOUND" }, { status:404 });

      const res = applyAction(r.state, body.side, body.payload);
      if (!res.ok) return NextResponse.json(res, { status:400 });

      if (res.patch) Object.assign(r.state, res.patch);
      return NextResponse.json({ ok:true, patch:res.patch ?? null, winner:res.winner ?? null });
    }

    return NextResponse.json({ ok:false, error:"UNKNOWN_ACTION" }, { status:400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "SERVER_ERROR";
    return NextResponse.json({ ok:false, error: msg }, { status:500 });
  }
}
