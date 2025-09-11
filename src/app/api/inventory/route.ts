// src/app/api/inventory/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- types & guards ---------- */
type Kind = "character" | "support" | "event";
type InvRow = { card_id: number; qty: number };
type CardRow = { id: number; code: string; kind: unknown };

function isKind(x: unknown): x is Kind {
  return x === "character" || x === "support" || x === "event";
}

/* ---------- handler ---------- */
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

    const invRows = (inv.data ?? []) as InvRow[];
    const ids = invRows.map((r) => Number(r.card_id));
    if (ids.length === 0) return NextResponse.json({ items: [] });

    // 2) card meta
    const cards = await supa
      .from("cards")
      .select("id, code, kind")
      .in("id", ids);

    if (cards.error) throw cards.error;

    const cardRows = (cards.data ?? []) as CardRow[];

    const meta = new Map<number, { code: string; kind: Kind }>();
    for (const c of cardRows) {
      const kind: Kind = isKind(c.kind) ? c.kind : "support"; // default กันชน
      meta.set(Number(c.id), { code: String(c.code), kind });
    }

    const items = invRows.map((r) => {
      const m = meta.get(Number(r.card_id));
      return {
        cardId: Number(r.card_id),
        code: m?.code ?? `ID_${r.card_id}`,
        kind: (m?.kind ?? "support") as Kind,
        qty: Number(r.qty),
      };
    });

    return NextResponse.json({ items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `inventory failed: ${msg}` }, { status: 500 });
  }
}
