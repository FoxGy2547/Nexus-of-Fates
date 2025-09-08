// app/api/health/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const env = {
      DB_HOST: !!process.env.DB_HOST,
      DB_USER: !!process.env.DB_USER,
      DB_NAME: !!process.env.DB_NAME,
    };

    let db = null as null | unknown;
    try {
      const pool = getPool();
      const [rows] = await pool.query("SELECT 1 as ok");
      db = rows;
    } catch (e: any) {
      console.error("[/api/health] DB_ERROR:", e?.message || e);
      db = { error: String(e?.message || e) };
    }

    return NextResponse.json({ ok: true, route: "health", env, db });
  } catch (e: any) {
    console.error("[/api/health] ERROR:", e?.message || e);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
