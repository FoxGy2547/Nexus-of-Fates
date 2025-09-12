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

type InventoryRow = {
  user_id: number;
  [k: string]: number | null | undefined; // dynamic: char_1..12, card_1..3
};

type InventoryResponse = {
  ok: true;
  userId: number;
  chars: Record<number, number>; // 1..12
  others: Record<number, number>; // 1..3
  byCode: Record<string, number>;
  itemsPositive: Array<{ cardId: number; code: string; kind: Kind; qty: number }>;
};

const OTHER_ID_BASE = 100; // 101/102/103 = card_1..3

/* ========================= Mappings (code -> column) ========================= */
const json = cardsData as CardJson;

// characters
const codeToCharId = new Map<string, number>();
for (const ch of json.characters) codeToCharId.set(ch.code, ch.char_id);

// supports/events mapping to card_1..3
const s1 = json.supports[0]; // card_1
const s2 = json.supports[1]; // card_2
const e1 = json.events[0];   // card_3

const codeToOtherIdx = new Map<string, 1 | 2 | 3>();
if (s1) codeToOtherIdx.set(s1.code, 1);
if (s2) codeToOtherIdx.set(s2.code, 2);
if (e1) codeToOtherIdx.set(e1.code, 3);

// limit/exchange rules (only for card_*; char_* unlimited)
const CARD_LIMIT = 20;
const EX_RATE = 3;

type InvKey = keyof InventoryRow;

/* ========================= GET: read inventory ========================= */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? "0");
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ ok: false, error: "bad userId" });
    }

    const sel = await supa
      .from("inventorys")
      .select(
        "user_id, char_1, char_2, char_3, char_4, char_5, char_6, char_7, char_8, char_9, char_10, char_11, char_12, card_1, card_2, card_3"
      )
      .eq("user_id", userId)
      .maybeSingle<InventoryRow>();

    if (sel.error) throw sel.error;

    const row = (sel.data ?? {}) as InventoryRow;

    const chars: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) chars[i] = Number(row[`char_${i}` as InvKey] ?? 0);

    const others: Record<number, number> = {};
    for (let s = 1; s <= 3; s++) others[s] = Number(row[`card_${s}` as InvKey] ?? 0);

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
    return NextResponse.json({ ok: false, error: `inventory failed: ${msg}` });
  }
}

/* ========================= POST: grant cards + auto-exchange (card_* only) =========================
Body:
{
  "userId": 123,
  "grants": [
    { "code": "BLAZING_SIGIL", "qty": 5 },
    { "code": "HEALING_AMULET", "qty": 30 },
    { "code": "BLAZE_KNIGHT", "qty": 1 }
  ]
}
*/
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      userId?: number;
      grants?: Array<{ code: string; qty: number }>;
    };

    const userId = Number(body?.userId ?? 0);
    const grants = Array.isArray(body?.grants) ? body!.grants! : [];

    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }

    // load or create inventory row
    const sel = await supa
      .from("inventorys")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle<InventoryRow>();

    if (sel.error) throw sel.error;

    let inv: InventoryRow | null = (sel.data ?? null) as InventoryRow | null;

    if (!inv) {
      const seed = { user_id: userId } as InventoryRow;
      for (let i = 1; i <= 12; i++) seed[`char_${i}` as InvKey] = 0;
      for (let i = 1; i <= 3; i++) seed[`card_${i}` as InvKey] = 0;

      const ins = await supa.from("inventorys").insert(seed).select("*").maybeSingle<InventoryRow>();
      if (ins.error) throw ins.error;
      inv = ins.data as InventoryRow;
    }

    // safety assert
    if (!inv) throw new Error("inventory row not available");

    let gainedNP = 0;
    const updates: Partial<InventoryRow> = {};

    for (const g of grants) {
      if (!g || typeof g.code !== "string") continue;
      const code = g.code;
      const add = Math.max(0, Math.floor(Number(g.qty ?? 0)));
      if (!add) continue;

      // char_* unlimited
      const charId = codeToCharId.get(code);
      if (charId) {
        const col = `char_${charId}` as InvKey;
        const cur = Number(inv[col] ?? 0);
        const next = cur + add;
        inv[col] = next;
        updates[col] = next;
        continue;
      }

      // card_* with limit+exchange
      const idx = codeToOtherIdx.get(code);
      if (idx) {
        const col = `card_${idx}` as InvKey;
        const cur = Number(inv[col] ?? 0);
        let next = cur + add;

        if (next > CARD_LIMIT) {
          const excess = next - CARD_LIMIT;
          const convert = Math.floor(excess / EX_RATE); // 3:1
          const remainder = excess % EX_RATE;
          gainedNP += convert;
          next = CARD_LIMIT + remainder; // keep remainder 0..2
        }

        inv[col] = next;
        updates[col] = next;
        continue;
      }

      // unknown code -> ignore
    }

    if (Object.keys(updates).length > 0) {
      const up = await supa.from("inventorys").update(updates).eq("user_id", userId);
      if (up.error) throw up.error;
    }

    if (gainedNP > 0) {
      const userSel = await supa
        .from("users")
        .select("nexus_point")
        .eq("id", userId)
        .maybeSingle<{ nexus_point: number }>();
      if (userSel.error) throw userSel.error;

      const curNP = Number(userSel.data?.nexus_point ?? 0);
      const upUser = await supa
        .from("users")
        .update({ nexus_point: curNP + gainedNP })
        .eq("id", userId);
      if (upUser.error) throw upUser.error;
    }

    return NextResponse.json({ ok: true, gainedNP });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `inventory update failed: ${msg}` }, { status: 500 });
  }
}
