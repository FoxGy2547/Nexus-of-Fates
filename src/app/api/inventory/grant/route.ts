// src/app/api/inventory/grant/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userId, cardId, qty } = await req.json();
  if (!userId || !cardId || typeof qty !== "number") {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  const pool = getPool();
  await pool.query(
    `INSERT INTO user_inventory(user_id, card_id, qty)
     VALUES($1,$2,$3)
     ON CONFLICT (user_id, card_id)
     DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
    [userId, cardId, qty]
  );
  return NextResponse.json({ ok: true });
}
