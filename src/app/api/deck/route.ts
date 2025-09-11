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

/* =========================================================
 * GET  /api/deck?userId=##
 * - อ่านเด็คที่ is_active = true ของ user
 * - แปลงออกเป็นรูปแบบที่หน้า deck-builder preload ได้เลย
 * =======================================================*/

type DeckRow = {
  id: number;
  user_id: number;
  name: string | null;
  is_active: boolean | null;
  created_at?: string | null;
  card_char1: number | null;
  card_char2: number | null;
  card_char3: number | null;
  // card1..card20
  card1: number | null;  card2: number | null;  card3: number | null;  card4: number | null;  card5: number | null;
  card6: number | null;  card7: number | null;  card8: number | null;  card9: number | null;  card10: number | null;
  card11: number | null; card12: number | null; card13: number | null; card14: number | null; card15: number | null;
  card16: number | null; card17: number | null; card18: number | null; card19: number | null; card20: number | null;
};

type GetDeckResponse = {
  ok: true;
  deckId: number | null;
  name: string;
  characters: number[]; // 1..12
  cards: { cardId: number; count: number }[]; // 101..103, นับรวมจากช่อง card1..card20
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? "0");
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }

    // อ่านเด็คที่ active ของ user
    const { data, error } = await supa
      .from("decks")
      .select(
        [
          "id",
          "user_id",
          "name",
          "is_active",
          "card_char1",
          "card_char2",
          "card_char3",
          // 20 ใบ
          "card1","card2","card3","card4","card5",
          "card6","card7","card8","card9","card10",
          "card11","card12","card13","card14","card15",
          "card16","card17","card18","card19","card20",
        ].join(","),
      )
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<DeckRow>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // ถ้าไม่มีเด็ค active ก็ส่งโครงว่าง ๆ เพื่อให้ UI ไม่พัง
    if (!data) {
      const payload: GetDeckResponse = {
        ok: true,
        deckId: null,
        name: "My Deck",
        characters: [],
        cards: [],
      };
      return NextResponse.json(payload);
    }

    // characters: เก็บเฉพาะตัวเลข 1..12 ที่ไม่ null
    const charSlots: (keyof DeckRow)[] = ["card_char1", "card_char2", "card_char3"];
    const characters = charSlots
      .map((k) => {
        const v = data[k];
        return typeof v === "number" ? v : null;
      })
      .filter((v): v is number => v != null && v >= 1 && v <= 12);

    // others: card1..card20 นับจำนวนของ 101/102/103
    const otherKeys: (keyof DeckRow)[] = Array.from({ length: 20 }, (_, i) => `card${i + 1}` as keyof DeckRow);
    const counter: Record<number, number> = {}; // key = 101..103

    for (const k of otherKeys) {
      const v = data[k];
      const n = typeof v === "number" ? v : null;
      if (n && n >= 101 && n <= 103) {
        counter[n] = (counter[n] ?? 0) + 1;
      }
    }

    const cards = (Object.keys(counter) as unknown as number[])
      .sort((a, b) => a - b)
      .map((id) => ({ cardId: id, count: counter[id] }));

    const payload: GetDeckResponse = {
      ok: true,
      deckId: data.id,
      name: data.name ?? "My Deck",
      characters,
      cards,
    };
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `deck get failed: ${msg}` }, { status: 500 });
  }
}

/* =========================================================
 * POST  /api/deck
 * - บันทึกเด็คตามกติกาเดิม (ตัวละคร ≤3, การ์ดอื่นรวม ≤20)
 * - ตรวจสต็อกจากตาราง inventorys
 * =======================================================*/

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
