import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { supa } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = (await getServerSession()) as Session | null;

    // ไม่มี session → บอก ok:false เพื่อให้ฝั่งหน้าเว็บตัดสินใจเอง
    if (!session?.user) {
      return NextResponse.json({ ok: false });
    }

    const email = session.user.email ?? null;
    const providerId = (session as unknown as { user?: { id?: string } })?.user?.id ?? null;

    let user:
      | { id: number; username: string | null; email: string | null; discord_id: string | null }
      | null = null;

    if (email) {
      const { data, error } = await supa
        .from("users")
        .select("id, username, email, discord_id")
        .eq("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) user = { id: Number(data.id), username: data.username, email: data.email, discord_id: data.discord_id };
    }

    if (!user && providerId) {
      const { data, error } = await supa
        .from("users")
        .select("id, username, email, discord_id")
        .eq("discord_id", String(providerId))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) user = { id: Number(data.id), username: data.username, email: data.email, discord_id: data.discord_id };
    }

    if (!user) {
      // ไม่เจอใน DB ก็ให้ ok:false
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        discordId: user.discord_id,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // ส่ง ok:false แทนการ 5xx เพื่อลดโอกาสค้างโหลดจาก fetch throw
    return NextResponse.json({ ok: false, error: `me route failed: ${msg}` });
  }
}
