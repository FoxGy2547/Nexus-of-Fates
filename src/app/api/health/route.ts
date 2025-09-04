import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    if (!pool) return NextResponse.json({ ok: true, db: "disabled" });
    await pool.query("SELECT 1");
    return NextResponse.json({ ok: true, db: "ok" });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "db-fail" },
      { status: 500 }
    );
  }
}
