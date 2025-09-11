// src/app/api/deck/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

type SaveBody = {
  deckId?: number;
  userId: number;
  name: string;
  characters: number[];                          // card_id (≤3)
  cards: { cardId: number; count: number }[];   // รวม ≤20
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as SaveBody;
  if (!body?.userId || !body?.name) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  if (!Array.isArray(body.characters) || body.characters.length > 3)
    return NextResponse.json({ error: "characters > 3" }, { status: 400 });
  const totalOthers = body.cards.reduce((a, b) => a + (b.count || 0), 0);
  if (totalOthers > 20) return NextResponse.json({ error: "support/events > 20" }, { status: 400 });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ตรวจ stock จาก user_inventory
    const allIds = [...body.characters, ...body.cards.map(c => c.cardId)];
    const params = [body.userId, ...allIds];
    const placeholders = allIds.map((_, i) => `$${i + 2}`).join(",") || "NULL";
    const stockRes = await client.query(
      `SELECT card_id, qty FROM user_inventory
       WHERE user_id = $1 AND card_id IN (${placeholders})`,
      params
    );
    const stock = new Map<number, number>();
    stockRes.rows.forEach(r => stock.set(Number(r.card_id), Number(r.qty)));

    // ตัวละครห้ามซ้ำและต้องมี
    const uniq = new Set(body.characters);
    if (uniq.size !== body.characters.length) throw new Error("duplicate characters");
    for (const cid of body.characters) if ((stock.get(cid) || 0) < 1) throw new Error("character not owned");

    // อื่น ๆ ห้ามเกินที่มี
    for (const it of body.cards) {
      if (it.count < 0) throw new Error("bad count");
      if (it.count > (stock.get(it.cardId) || 0)) throw new Error("exceed inventory");
    }

    // สร้าง/อัปเดต deck
    let deckId = body.deckId;
    if (!deckId) {
      const res = await client.query(
        `INSERT INTO decks(user_id, name, is_active, created_at)
         VALUES($1,$2, TRUE, NOW()) RETURNING id`,
        [body.userId, body.name]
      );
      deckId = Number(res.rows[0].id);
    } else {
      await client.query(`UPDATE decks SET name=$1 WHERE id=$2 AND user_id=$3`, [body.name, deckId, body.userId]);
      await client.query(`DELETE FROM deck_chars WHERE deck_id=$1`, [deckId]);
      await client.query(`DELETE FROM deck_cards WHERE deck_id=$1`, [deckId]);
    }

    // ใส่ตัวละคร
    for (let i = 0; i < body.characters.length; i++) {
      await client.query(`INSERT INTO deck_chars(deck_id, slot, card_id) VALUES($1,$2,$3)`, [
        deckId,
        i + 1,
        body.characters[i],
      ]);
    }

    // ใส่การ์ดอื่น
    for (const it of body.cards) {
      if (it.count > 0) {
        await client.query(`INSERT INTO deck_cards(deck_id, card_id, count) VALUES($1,$2,$3)`, [
          deckId,
          it.cardId,
          it.count,
        ]);
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, deckId });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: e.message || "save failed" }, { status: 400 });
  } finally {
    client.release();
  }
}
