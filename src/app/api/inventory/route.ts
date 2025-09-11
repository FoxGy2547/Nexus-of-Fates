// src/app/api/inventory/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = Number(url.searchParams.get("userId"));
  if (!userId) return NextResponse.json({ error: "missing userId" }, { status: 400 });

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT c.id AS card_id, c.code, c.kind, ui.qty
     FROM user_inventory ui
     JOIN cards c ON c.id = ui.card_id
     WHERE ui.user_id = $1 AND ui.qty > 0
     ORDER BY c.kind, c.code`,
    [userId]
  );

  return NextResponse.json({ items: rows.map(r => ({
    cardId: r.card_id, code: r.code, kind: r.kind, qty: Number(r.qty)
  })) });
}
