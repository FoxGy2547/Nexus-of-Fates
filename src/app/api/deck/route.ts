// src/app/api/deck/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

type SaveBody = {
  userId: number;
  name: string;
  characters: number[];                          // card_id ≤ 3
  cards: { cardId: number; count: number }[];   // รวม ≤ 20
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as SaveBody;

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

  // เตรียมข้อมูลลงคอลัมน์ decks.card1..card20
  const flatOthers: number[] = [];
  for (const it of body.cards) {
    for (let i = 0; i < it.count; i++) flatOthers.push(it.cardId);
  }
  const others20 = (flatOthers.slice(0, 20) as (number | null)[])
    .concat(Array(20).fill(null))
    .slice(0, 20);

  const chars3 = (body.characters.slice(0, 3) as (number | null)[])
    .concat([null, null, null])
    .slice(0, 3);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ตรวจสต็อกจาก user_inventory
    const allIds = [...body.characters, ...body.cards.map(c => c.cardId)];
    if (allIds.length) {
      const params = [body.userId, ...allIds];
      const placeholders = allIds.map((_, i) => `$${i + 2}`).join(",");
      const stockRes = await client.query<{ card_id: number; qty: number }>(
        `SELECT card_id, qty FROM user_inventory
         WHERE user_id = $1 AND card_id IN (${placeholders})`,
        params
      );
      const stock = new Map<number, number>();
      stockRes.rows.forEach(r => stock.set(Number(r.card_id), Number(r.qty)));

      // ตัวละครห้ามซ้ำและต้องมี
      const uniq = new Set(body.characters);
      if (uniq.size !== body.characters.length) throw new Error("duplicate characters");
      for (const cid of body.characters) {
        if ((stock.get(cid) || 0) < 1) throw new Error("character not owned");
      }
      // การ์ดอื่นห้ามเกินที่มี
      for (const it of body.cards) {
        if (it.count < 0) throw new Error("bad count");
        if (it.count > (stock.get(it.cardId) || 0)) throw new Error("exceed inventory");
      }
    }

    // หา deck ที่ active ของผู้ใช้
    const ex = await client.query<{ id: number }>(
      `SELECT id FROM decks WHERE user_id = $1 AND is_active IS TRUE LIMIT 1`,
      [body.userId]
    );

    if (ex.rowCount && ex.rows[0]) {
      // UPDATE
      const deckId = ex.rows[0].id;
      const setCols = [
        "name = $2",
        "card_char1 = $3",
        "card_char2 = $4",
        "card_char3 = $5",
        ...Array.from({ length: 20 }, (_, i) => `card${i + 1} = $${6 + i}`),
      ].join(", ");

      await client.query(
        `UPDATE decks SET ${setCols} WHERE id = $1`,
        [
          deckId,
          body.name,
          chars3[0], chars3[1], chars3[2],
          ...others20,
        ]
      );
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, deckId });
    } else {
      // INSERT (active deck แรกของผู้ใช้)
      const cols = [
        "user_id", "name",
        "card_char1", "card_char2", "card_char3",
        ...Array.from({ length: 20 }, (_, i) => `card${i + 1}`),
        "is_active", "created_at",
      ];
      const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
      const values = [
        body.userId,
        body.name,
        chars3[0], chars3[1], chars3[2],
        ...others20,
        true, new Date(),
      ];

      const ins = await client.query<{ id: number }>(
        `INSERT INTO decks(${cols.join(", ")}) VALUES(${ph}) RETURNING id`,
        values
      );
      const deckId = ins.rows[0].id;
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, deckId });
    }
  } catch (e: unknown) {
    await client.query("ROLLBACK");
    const msg = e instanceof Error ? e.message : "save failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  } finally {
    client.release();
  }
}
