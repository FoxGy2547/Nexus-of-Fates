// src/app/api/me/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // ไม่ต้อง authOptions
  const session = (await getServerSession()) as Session | null;

  if (!session?.user?.email) {
    // ยังไม่ล็อกอิน หรือ provider ไม่ส่งอีเมลมา
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const email = session.user.email;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, username, email, discord_id
       FROM users
      WHERE email = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [email]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "user not found in DB" }, { status: 404 });
  }

  const u = rows[0];
  return NextResponse.json({
    userId: Number(u.id),
    username: u.username,
    email: u.email,
    discordId: u.discord_id,
  });
}
