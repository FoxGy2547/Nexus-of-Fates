// src/app/api/deck/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";

type SaveBody = {
  userId: number;
  name: string;
  characters: number[];                        // 1..12 (จาก cards.json)
  cards: { cardId: number; count: number }[];  // 101..103 = card_1..3
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTHER_ID_BASE = 100;
type Slot = 1 | 2 | 3;

function idToSlot(cardId: number): Slot | null {
  const s = cardId - OTHER_ID_BASE;
  return s === 1 || s === 2 || s === 3 ? (s as Slot) : null;
}

function padToNumNull(arr: number[], len: number): (number | null)[] {
  if (arr.length >= len) return arr.slice(0, len) as (number | null)[];
  const padCount = len - arr.length;
  const pad = Array<number | null>(padCount).fill(null);
  return (arr as (number | null)[]).concat(pad);
}

export async function POST(req: Request) {
  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  if (!body?.userId || !body?.name) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (!Array.isArray(body.characters) || body.characters.length > 3) {
    return NextResponse.json({ error: "characters > 3" }, { status: 400 });
  }
  const totalOthers = body.cards.reduce((a, b) => a + (b.count || 0), 0);
  if (totalOthers > 20) {
    return NextResponse.json({ error: "support/events > 20" }, { status: 400 });
  }

  // โหลดสต็อกจาก inventorys
  const inv = await supa
    .from("inventorys")
    .select(
      "char_1, char_2, char_3, char_4, char_5, char_6, char_7, char_8, char_9, char_10, char_11, char_12, card_1, card_2, card_3"
    )
    .eq("user_id", body.userId)
    .maybeSingle();

  if (inv.error) {
    return NextResponse.json({ error: inv.error.message }, { status: 400 });
  }
  if (!inv.data) {
    return NextResponse.json({ error: "no inventory" }, { status: 400 });
  }

  const row = inv.data as Record<string, unknown>;

  // ตัวละคร: ห้ามซ้ำ + ต้องมีของ ≥1
  const uniq = new Set(body.characters);
  if (uniq.size !== body.characters.length) {
    return NextResponse.json({ error: "duplicate characters" }, { status: 400 });
  }
  for (const cid of body.characters) {
    if (cid < 1 || cid > 12) {
      return NextResponse.json({ error: `invalid character id ${cid}` }, { status: 400 });
    }
    const qty = Number(row[`char_${cid}`] ?? 0);
    if (qty < 1) {
      return NextResponse.json({ error: `character ${cid} not owned` }, { status: 400 });
    }
  }

  // การ์ดเสริม/อีเวนต์: รวมไม่เกินสต็อกใน card_1..3
  const use: Record<Slot, number> = { 1: 0, 2: 0, 3: 0 };

  for (const it of body.cards) {
    const slot = idToSlot(it.cardId);
    if (slot === null) {
      return NextResponse.json({ error: `invalid support/event id ${it.cardId}` }, { status: 400 });
    }
    if (it.count < 0) {
      return NextResponse.json({ error: "bad count" }, { status: 400 });
    }
    use[slot] = use[slot] + it.count;
  }

  if (use[1] > Number(row["card_1"] ?? 0)) {
    return NextResponse.json({ error: "exceed inventory (card_1)" }, { status: 400 });
  }
  if (use[2] > Number(row["card_2"] ?? 0)) {
    return NextResponse.json({ error: "exceed inventory (card_2)" }, { status: 400 });
  }
  if (use[3] > Number(row["card_3"] ?? 0)) {
    return NextResponse.json({ error: "exceed inventory (card_3)" }, { status: 400 });
  }

  // เตรียมข้อมูลลง decks
  const chars3: (number | null)[] = padToNumNull(body.characters.slice(0, 3), 3);

  const flatOthers: number[] = [];
  for (const it of body.cards) {
    for (let i = 0; i < it.count; i++) flatOthers.push(it.cardId); // 101..103
  }
  const others20: (number | null)[] = padToNumNull(flatOthers.slice(0, 20), 20);

  // หา active deck ของ user
  const ex = await supa
    .from("decks")
    .select("id")
    .eq("user_id", body.userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (ex.error) {
    return NextResponse.json({ error: ex.error.message }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    name: body.name,
    card_char1: chars3[0],
    card_char2: chars3[1],
    card_char3: chars3[2],
    is_active: true,
  };
  for (let i = 0; i < 20; i++) payload[`card${i + 1}`] = others20[i];

  if (ex.data) {
    const upd = await supa.from("decks").update(payload).eq("id", ex.data.id).select("id").single();
    if (upd.error) {
      return NextResponse.json({ error: upd.error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, deckId: Number(upd.data.id) });
  } else {
    const ins = await supa
      .from("decks")
      .insert([{ user_id: body.userId, created_at: new Date().toISOString(), ...payload }])
      .select("id")
      .single();
    if (ins.error) {
      return NextResponse.json({ error: ins.error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, deckId: Number(ins.data.id) });
  }
}
