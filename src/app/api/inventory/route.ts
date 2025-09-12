// src/app/api/inventory/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";
import cardsData from "@/data/cards.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========================= Types ========================= */
type Kind = "character" | "support" | "event";

type CardJson = {
  characters: { char_id: number; code: string }[];
  supports: { id: number; code: string }[];
  events: { id: number; code: string }[];
};

type KeyChar = `char_${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
type KeyCard = `card_${1 | 2 | 3}`;
type InvKey = KeyChar | KeyCard;

type InventoryRow = {
  user_id: number;
} & Partial<Record<InvKey, number | null>>;

type InventoryResponse = {
  ok: true;
  userId: number;
  chars: Record<number, number>; // 1..12
  others: Record<number, number>; // 1..3
  byCode: Record<string, number>;
  itemsPositive: Array<{ cardId: number; code: string; kind: Kind; qty: number }>;
};

const OTHER_ID_BASE = 100; // 101/102/103 = card_1..3
const CARD_LIMIT = 20;
const EX_RATE = 3;

const CHAR_IDS: Readonly<number[]> = Array.from({ length: 12 }, (_, i) => i + 1);
const CARD_IDX: Readonly<number[]> = [1, 2, 3];

/* ========================= Helpers ========================= */
const json = cardsData as CardJson;

// characters: code -> char_id
const codeToCharId = new Map<string, number>();
for (const ch of json.characters) codeToCharId.set(ch.code, ch.char_id);

// we map others: supports[0] -> card_1, supports[1] -> card_2, events[0] -> card_3
const s1 = json.supports[0]; // card_1
const s2 = json.supports[1]; // card_2
const e1 = json.events[0];   // card_3

const codeToOtherIdx = new Map<string, 1 | 2 | 3>();
if (s1) codeToOtherIdx.set(s1.code, 1);
if (s2) codeToOtherIdx.set(s2.code, 2);
if (e1) codeToOtherIdx.set(e1.code, 3);

// build empty row object (for insert)
function defaultInventory(userId: number): InventoryRow {
  const seed: InventoryRow = { user_id: userId };
  for (const id of CHAR_IDS) {
    const key = `char_${id}` as KeyChar;
    seed[key] = 0;
  }
  for (const i of CARD_IDX) {
    const key = `card_${i}` as KeyCard;
    seed[key] = 0;
  }
  return seed;
}

function getCol(row: Partial<Record<InvKey, number | null>>, col: InvKey): number {
  return Number(row[col] ?? 0);
}

function setCol<T extends Partial<Record<InvKey, number | null>>>(
  obj: T,
  col: InvKey,
  value: number
): void {
  (obj as Record<InvKey, number | null>)[col] = value;
}

/* ========================= GET ========================= */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? "0");
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ ok: false, error: "bad userId" }, { status: 400 });
    }

    // read or create inventory row
    const sel = await supa
      .from("inventorys")
      .select(
        "user_id, char_1, char_2, char_3, char_4, char_5, char_6, char_7, char_8, char_9, char_10, char_11, char_12, card_1, card_2, card_3"
      )
      .eq("user_id", userId)
      .maybeSingle<InventoryRow>();

    if (sel.error) throw sel.error;

    let row = sel.data ?? null;
    if (!row) {
      const ins = await supa
        .from("inventorys")
        .insert(defaultInventory(userId))
        .select(
          "user_id, char_1, char_2, char_3, char_4, char_5, char_6, char_7, char_8, char_9, char_10, char_11, char_12, card_1, card_2, card_3"
        )
        .maybeSingle<InventoryRow>();
      if (ins.error) throw ins.error;
      row = ins.data ?? defaultInventory(userId);
    }

    const chars: Record<number, number> = {};
    for (const i of CHAR_IDS) chars[i] = Number(row[`char_${i}` as KeyChar] ?? 0);

    const others: Record<number, number> = {};
    for (const i of CARD_IDX) others[i] = Number(row[`card_${i}` as KeyCard] ?? 0);

    const byCode: Record<string, number> = {};
    for (const ch of json.characters) byCode[ch.code] = chars[ch.char_id] ?? 0;
    if (s1) byCode[s1.code] = others[1] ?? 0;
    if (s2) byCode[s2.code] = others[2] ?? 0;
    if (e1) byCode[e1.code] = others[3] ?? 0;

    const itemsPositive: InventoryResponse["itemsPositive"] = [];
    for (const ch of json.characters) {
      const qty = chars[ch.char_id] ?? 0;
      if (qty > 0) itemsPositive.push({ cardId: ch.char_id, code: ch.code, kind: "character", qty });
    }
    if (s1 && (others[1] ?? 0) > 0)
      itemsPositive.push({ cardId: OTHER_ID_BASE + 1, code: s1.code, kind: "support", qty: others[1] });
    if (s2 && (others[2] ?? 0) > 0)
      itemsPositive.push({ cardId: OTHER_ID_BASE + 2, code: s2.code, kind: "support", qty: others[2] });
    if (e1 && (others[3] ?? 0) > 0)
      itemsPositive.push({ cardId: OTHER_ID_BASE + 3, code: e1.code, kind: "event", qty: others[3] });

    const payload: InventoryResponse = { ok: true, userId, chars, others, byCode, itemsPositive };
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `inventory failed: ${msg}` }, { status: 400 });
  }
}

/* ========================= POST =========================
  Body:
  {
    "userId": 123,
    "grants": [
      { "code": "BLAZING_SIGIL", "qty": 5 },
      { "code": "HEALING_AMULET", "qty": 30 },
      { "code": "BLAZE_KNIGHT",  "qty": 1 }
    ]
  }
   แจกการ์ด + แปลงส่วนเกิน card_* เป็น Nexus Point (ทุก ๆ 3 ใบ -> 1 NP)
========================================================== */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      userId?: number;
      grants?: Array<{ code: string; qty: number }>;
    };

    const userId = Number(body?.userId ?? 0);
    const grants = (body?.grants ?? []).map((g) => ({
      code: String(g?.code ?? ""),
      qty: Math.max(0, Math.floor(Number(g?.qty ?? 0))),
    }));

    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }
    if (!Array.isArray(grants)) {
      return NextResponse.json({ error: "bad grants" }, { status: 400 });
    }

    // read or create inventory row
    const sel = await supa.from("inventorys").select("*").eq("user_id", userId).maybeSingle<InventoryRow>();
    if (sel.error) throw sel.error;

    let inv: InventoryRow;
    if (!sel.data) {
      const inserted = await supa.from("inventorys").insert(defaultInventory(userId)).select("*").maybeSingle<InventoryRow>();
      if (inserted.error) throw inserted.error;
      inv = inserted.data ?? defaultInventory(userId);
    } else {
      inv = sel.data;
    }

    let gainedNP = 0;
    const updates: Partial<Record<InvKey, number | null>> = {};

    for (const g of grants) {
      if (!g.code || g.qty <= 0) continue;

      // char_x
      const charId = codeToCharId.get(g.code);
      if (charId) {
        const col = `char_${charId}` as KeyChar;
        const next = getCol(inv, col) + g.qty; // no limit on characters
        setCol(inv, col, next);
        setCol(updates, col, next);
        continue;
      }

      // card_x (support/event)
      const idx = codeToOtherIdx.get(g.code);
      if (idx) {
        const col = `card_${idx}` as KeyCard;
        let next = getCol(inv, col) + g.qty;

        if (next > CARD_LIMIT) {
          const excess = next - CARD_LIMIT;
          const convert = Math.floor(excess / EX_RATE);
          const remainder = excess % EX_RATE;
          gainedNP += convert;
          next = CARD_LIMIT + remainder; // keep remainder 0..2 for next time
        }

        setCol(inv, col, next);
        setCol(updates, col, next);
        continue;
      }

      // unknown code -> skip
    }

    // persist inventory updates
    if (Object.keys(updates).length > 0) {
      const up = await supa.from("inventorys").update(updates).eq("user_id", userId);
      if (up.error) throw up.error;
    }

    // add nexus_point if converted
    if (gainedNP > 0) {
      const userSel = await supa.from("users").select("nexus_point").eq("id", userId).maybeSingle<{ nexus_point: number }>();
      if (userSel.error) throw userSel.error;
      const current = Number(userSel.data?.nexus_point ?? 0);
      const upUser = await supa.from("users").update({ nexus_point: current + gainedNP }).eq("id", userId);
      if (upUser.error) throw upUser.error;
    }

    return NextResponse.json({ ok: true, gainedNP });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `inventory update failed: ${msg}` }, { status: 500 });
  }
}
