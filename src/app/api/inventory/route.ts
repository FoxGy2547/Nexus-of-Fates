// src/app/api/inventory/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";
import cardsData from "@/data/cards.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "character" | "support" | "event";

type CardJson = {
  characters: { char_id: number; code: string }[];
  supports: { id: number; code: string }[];
  events:   { id: number; code: string }[];
};

type InventoryRow = {
  user_id: number;
  // char_1..char_12, card_1..card_3 อาจเป็น number หรือ null
  [k: string]: number | null | undefined;
};

type InventoryResponse = {
  ok: true;
  userId: number;
  /** ค่าเป็นจำนวนใบของทุกช่อง รวม 0 */
  char: Record<number, number>;              // 1..12
  card: Record<number, number>;              // 1..3 (support1, support2, event1)
  /** แผนที่ code → qty (ครบทุกใบ รวม 0) เพื่อให้ UI หาเร็ว */
  byCode: Record<string, number>;
  /** เฉพาะรายการที่มีของจริง ๆ (qty > 0) เผื่อ UI อยากแสดงสรุปแบบสั้น */
  itemsPositive: Array<{ cardId: number; code: string; kind: Kind; qty: number }>;
};

const OTHER_ID_BASE = 100; // 101/102/103 สำหรับ card_1..3

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? "0");
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }

    // อ่าน 1 แถวจากตาราง inventorys
    const { data, error } = await supa
      .from("inventorys")
      .select(
        "user_id, char_1, char_2, char_3, char_4, char_5, char_6, char_7, char_8, char_9, char_10, char_11, char_12, card_1, card_2, card_3"
      )
      .eq("user_id", userId)
      .maybeSingle<InventoryRow>();

    if (error) throw error;

    const row = (data ?? {}) as InventoryRow;
    const json = cardsData as CardJson;

    // 1) เติมค่าครบทุกช่อง (รวม 0)
    const char: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) {
      char[i] = Number(row[`char_${i}`] ?? 0);
    }
    const card: Record<number, number> = {};
    for (let s = 1; s <= 3; s++) {
      card[s] = Number(row[`card_${s}`] ?? 0);
    }

    // 2) map เป็น code → qty (ครบทุกใบ)
    const byCode: Record<string, number> = {};
    for (const ch of json.characters) {
      byCode[ch.code] = char[ch.char_id] ?? 0;
    }
    const s1 = json.supports[0]; // card_1
    const s2 = json.supports[1]; // card_2
    const e1 = json.events[0];   // card_3
    if (s1) byCode[s1.code] = card[1] ?? 0;
    if (s2) byCode[s2.code] = card[2] ?? 0;
    if (e1) byCode[e1.code] = card[3] ?? 0;

    // 3) รายการแบบย่อเฉพาะที่ qty > 0 (ไว้โชว์ quick summary)
    const itemsPositive: InventoryResponse["itemsPositive"] = [];
    for (const ch of json.characters) {
      const qty = char[ch.char_id] ?? 0;
      if (qty > 0) {
        itemsPositive.push({ cardId: ch.char_id, code: ch.code, kind: "character", qty });
      }
    }
    if (s1 && (card[1] ?? 0) > 0) {
      itemsPositive.push({ cardId: OTHER_ID_BASE + 1, code: s1.code, kind: "support", qty: card[1] });
    }
    if (s2 && (card[2] ?? 0) > 0) {
      itemsPositive.push({ cardId: OTHER_ID_BASE + 2, code: s2.code, kind: "support", qty: card[2] });
    }
    if (e1 && (card[3] ?? 0) > 0) {
      itemsPositive.push({ cardId: OTHER_ID_BASE + 3, code: e1.code, kind: "event", qty: card[3] });
    }

    const payload: InventoryResponse = {
      ok: true,
      userId,
      char,
      card,
      byCode,
      itemsPositive,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `inventory failed: ${msg}` }, { status: 500 });
  }
}
