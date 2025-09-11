// src/app/api/me/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { supa } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = (await getServerSession()) as Session | null;
    if (!session?.user) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const email = session.user.email ?? null;
    const providerId = (session as unknown as { user?: { id?: string } })?.user?.id ?? null;

    // หา user ด้วย email ก่อน ไม่เจอค่อยลอง discord_id
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
      return NextResponse.json({ error: "user not found in DB" }, { status: 404 });
    }

    return NextResponse.json({
      userId: user.id,
      username: user.username,
      email: user.email,
      discordId: user.discord_id,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `me route failed: ${msg}` }, { status: 500 });
  }
}
