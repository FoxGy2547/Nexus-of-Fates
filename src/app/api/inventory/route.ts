// src/app/api/inventory/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";
import cardsData from "@/data/cards.json"; // ต้องเปิด tsconfig: "resolveJsonModule": true

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "character" | "support" | "event";
type Item = { cardId: number; code: string; kind: Kind; qty: number };

const OTHER_ID_BASE = 100; // สร้างไอดีภายในให้การ์ดเสริม/อีเวนต์: 101..103 = card_1..card_3

function slotToOtherId(slot: 1 | 2 | 3): number {
  return OTHER_ID_BASE + slot;
}

function isKind(x: unknown): x is Kind {
  return x === "character" || x === "support" || x === "event";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? "0");
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }

    // 1) อ่าน 1 แถวจาก inventorys
    const invRes = await supa
      .from("inventorys")
      .select(
        "char_1, char_2, char_3, char_4, char_5, char_6, char_7, char_8, char_9, char_10, char_11, char_12, card_1, card_2, card_3"
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (invRes.error) throw invRes.error;
    const row = (invRes.data ?? {}) as Record<string, unknown>;

    // 2) อ่าน meta จาก cards.json (ไม่แตะ DB)
    const characters = (cardsData as {
      characters: { char_id: number; code: string }[];
      supports: { id: number; code: string }[];
      events: { id: number; code: string }[];
    }).characters;

    const supports = (cardsData as { supports: { id: number; code: string }[] }).supports;
    const events = (cardsData as { events: { id: number; code: string }[] }).events;

    const items: Item[] = [];

    // characters: char_i → id = i
    for (const ch of characters) {
      const qty = Number(row[`char_${ch.char_id}`] ?? 0);
      if (qty > 0) {
        items.push({
          cardId: ch.char_id,
          code: ch.code,
          kind: "character",
          qty,
        });
      }
    }

    // supports/events: card_1..3 → (supports[0], supports[1], events[0])
    const mapping: { slot: 1 | 2 | 3; code: string; kind: Kind }[] = [
      { slot: 1, code: supports?.[0]?.code ?? "CARD_1", kind: "support" },
      { slot: 2, code: supports?.[1]?.code ?? "CARD_2", kind: "support" },
      { slot: 3, code: events?.[0]?.code ?? "CARD_3", kind: "event" },
    ];

    for (const m of mapping) {
      const qty = Number(row[`card_${m.slot}`] ?? 0);
      if (qty > 0) {
        items.push({
          cardId: slotToOtherId(m.slot), // 101/102/103
          code: m.code,
          kind: m.kind,
          qty,
        });
      }
    }

    return NextResponse.json({ items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `inventory failed: ${msg}` }, { status: 500 });
  }
}
