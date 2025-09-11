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
  [k: string]: number | null | undefined; // char_1..12, card_1..3
};

type InventoryResponse = {
  ok: true;
  userId: number;
  chars: Record<number, number>;   // 1..12
  others: Record<number, number>;  // 1..3
  byCode: Record<string, number>;
  itemsPositive: Array<{ cardId: number; code: string; kind: Kind; qty: number }>;
};

const OTHER_ID_BASE = 100; // 101/102/103 = card_1..3

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
    const json = cardsData as CardJson;

    const chars: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) chars[i] = Number(row[`char_${i}`] ?? 0);

    const others: Record<number, number> = {};
    for (let s = 1; s <= 3; s++) others[s] = Number(row[`card_${s}`] ?? 0);

    const byCode: Record<string, number> = {};
    for (const ch of json.characters) byCode[ch.code] = chars[ch.char_id] ?? 0;

    const s1 = json.supports[0]; // card_1
    const s2 = json.supports[1]; // card_2
    const e1 = json.events[0];   // card_3
    if (s1) byCode[s1.code] = others[1] ?? 0;
    if (s2) byCode[s2.code] = others[2] ?? 0;
    if (e1) byCode[e1.code] = others[3] ?? 0;

    const itemsPositive: InventoryResponse["itemsPositive"] = [];
    for (const ch of json.characters) {
      const qty = chars[ch.char_id] ?? 0;
      if (qty > 0) itemsPositive.push({ cardId: ch.char_id, code: ch.code, kind: "character", qty });
    }
    if (s1 && (others[1] ?? 0) > 0) itemsPositive.push({ cardId: OTHER_ID_BASE + 1, code: s1.code, kind: "support", qty: others[1] });
    if (s2 && (others[2] ?? 0) > 0) itemsPositive.push({ cardId: OTHER_ID_BASE + 2, code: s2.code, kind: "support", qty: others[2] });
    if (e1 && (others[3] ?? 0) > 0) itemsPositive.push({ cardId: OTHER_ID_BASE + 3, code: e1.code, kind: "event",   qty: others[3] });

    const payload: InventoryResponse = {
      ok: true,
      userId,
      chars,
      others,
      byCode,
      itemsPositive,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `inventory failed: ${msg}` });
  }
}
