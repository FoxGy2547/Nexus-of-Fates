// src/app/api/inventory/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? "0");
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }

    // 1) inventory rows
    const inv = await supa
      .from("user_inventory")
      .select("card_id, qty")
      .eq("user_id", userId);

    if (inv.error) throw inv.error;

    const ids = (inv.data ?? []).map((r) => Number(r.card_id));
    if (ids.length === 0) return NextResponse.json({ items: [] });

    // 2) card meta
    const cards = await supa
      .from("cards")
      .select("id, code, kind")
      .in("id", ids);

    if (cards.error) throw cards.error;

    const meta = new Map<number, { code: string; kind: "character" | "support" | "event" }>();
    (cards.data ?? []).forEach((c) => {
      meta.set(Number(c.id), { code: String(c.code), kind: c.kind as any });
    });

    const items = (inv.data ?? []).map((r) => {
      const m = meta.get(Number(r.card_id));
      return {
        cardId: Number(r.card_id),
        code: m?.code ?? `ID_${r.card_id}`,
        kind: (m?.kind ?? "support") as "character" | "support" | "event",
        qty: Number(r.qty),
      };
    });

    return NextResponse.json({ items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `inventory failed: ${msg}` }, { status: 500 });
  }
}
