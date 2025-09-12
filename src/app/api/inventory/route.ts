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
  [k: string]: number | null | undefined; // char_1..12, card_1..3
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

/* ========================= Helpers for mapping code -> column ========================= */
const json = cardsData as CardJson;

// characters: code -> char_id
const codeToCharId = new Map<string, number>();
for (const ch of json.characters) codeToCharId.set(ch.code, ch.char_id);

// weผูก others ตามเดิม: supports[0] -> card_1, supports[1] -> card_2, events[0] -> card_3
const s1 = json.supports[0]; // card_1
const s2 = json.supports[1]; // card_2
const e1 = json.events[0]; // card_3

const codeToOtherIdx = new Map<string, 1 | 2 | 3>();
if (s1) codeToOtherIdx.set(s1.code, 1);
if (s2) codeToOtherIdx.set(s2.code, 2);
if (e1) codeToOtherIdx.set(e1.code, 3);

// จำกัด 20 เฉพาะ card_* เท่านั้น (char_* ไม่จำกัด) และส่วนเกินแปลง 3:1 เป็น Nexus Point
const CARD_LIMIT = 20;
const EX_RATE = 3;

/* ========================= GET: อ่านคลัง ========================= */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? "0");
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ ok: false, error: "bad userId" });
    }

    const { data, error } = await supa
      .from("inventorys")
      .select(
        "user_id, char_1, char_2, char_3, char_4, char_5, char_6, char_7, char_8, char_9, char_10, char_11, char_12, card_1, card_2, card_3"
      )
      .eq("user_id", userId)
      .maybeSingle<InventoryRow>();

    if (error) throw error;

    const row = (data ?? {}) as InventoryRow;

    const chars: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) chars[i] = Number(row[`char_${i}`] ?? 0);

    const others: Record<number, number> = {};
    for (let s = 1; s <= 3; s++) others[s] = Number(row[`card_${s}`] ?? 0);

    const byCode: Record<string, number> = {};
    for (const ch of json.characters) byCode[ch.code] = chars[ch.char_id] ?? 0;
    if (s1) byCode[s1.code] = others[1] ?? 0;
    if (s2) byCode[s2.code] = others[2] ?? 0;
    if (e1) byCode[e1.code] = others[3] ?? 0;

    const itemsPositive: InventoryResponse["itemsPositive"] = [];
    for (const ch of json.characters) {
      const qty = chars[ch.char_id] ?? 0;
      if (qty > 0)
        itemsPositive.push({ cardId: ch.char_id, code: ch.code, kind: "character", qty });
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

/* ========================= POST: แจกการ์ด + แปลงส่วนเกิน card_* เป็น Nexus Point =========================
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
    const body = await req.json().catch(() => ({}));
    const userId = Number(body?.userId ?? 0);
    const grants = (body?.grants ?? []) as Array<{ code: string; qty: number }>;

    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }
    if (!Array.isArray(grants)) {
      return NextResponse.json({ error: "bad grants" }, { status: 400 });
    }

    // ดึงแถวคลัง (หรือสร้างถ้ายังไม่มี)
    let { data: inv, error } = await supa
      .from("inventorys")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle<InventoryRow>();
    if (error) throw error;

    if (!inv) {
      const seed: InventoryRow = { user_id: userId };
      for (let i = 1; i <= 12; i++) (seed as any)[`char_${i}`] = 0;
      for (let i = 1; i <= 3; i++) (seed as any)[`card_${i}`] = 0;
      const ins = await supa.from("inventorys").insert(seed).select("*").maybeSingle<InventoryRow>();
      if (ins.error) throw ins.error;
      inv = ins.data as InventoryRow;
    }

    let gainedNP = 0;
    const updates: Partial<InventoryRow> = {};

    for (const g of grants) {
      const code = String(g?.code || "");
      const add = Math.max(0, Math.floor(Number(g?.qty ?? 0)));
      if (!code || !add) continue;

      // char_x
      const charId = codeToCharId.get(code);
      if (charId) {
        const col = `char_${charId}` as const;
        const cur = Number(inv[col] ?? 0);
        const next = cur + add; // ไม่มีลิมิต
        (inv as any)[col] = next;
        (updates as any)[col] = next;
        continue;
      }

      // card_x (support/event)
      const idx = codeToOtherIdx.get(code);
      if (idx) {
        const col = `card_${idx}` as const;
        const cur = Number(inv[col] ?? 0);
        let next = cur + add;

        if (next > CARD_LIMIT) {
          const excess = next - CARD_LIMIT; // ส่วนที่เกิน 20
          const convert = Math.floor(excess / EX_RATE); // 3:1
          const remainder = excess % EX_RATE;
          gainedNP += convert;
          next = CARD_LIMIT + remainder; // เก็บเศษ 1–2 ไว้ (จะได้สะสมครบ 3 ค่อยแปลงรอบหน้า)
        }

        (inv as any)[col] = next;
        (updates as any)[col] = next;
        continue;
      }

      // code ไม่รู้จัก -> ข้าม
    }

    // บันทึก inventory
    if (Object.keys(updates).length > 0) {
      const up = await supa.from("inventorys").update(updates).eq("user_id", userId);
      if (up.error) throw up.error;
    }

    // เพิ่ม Nexus Point ถ้ามี
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
