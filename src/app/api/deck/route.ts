// src/app/api/deck/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";

type SaveBody = {
  userId: number;
  name: string;
  characters: number[];                        // ≤ 3
  cards: { cardId: number; count: number }[];  // รวม ≤ 20
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SaveBody;

    if (!body?.userId || !body?.name) return NextResponse.json({ error: "missing fields" }, { status: 400 });
    if (!Array.isArray(body.characters) || body.characters.length > 3) {
      return NextResponse.json({ error: "characters > 3" }, { status: 400 });
    }
    const totalOthers = body.cards.reduce((a, b) => a + (b.count || 0), 0);
    if (totalOthers > 20) return NextResponse.json({ error: "support/events > 20" }, { status: 400 });

    // สร้าง array 3 / 20 สำหรับคอลัมน์
    const chars3 = (body.characters.slice(0, 3) as (number | null)[])
      .concat([null, null, null])
      .slice(0, 3);

    const flatOthers: number[] = [];
    for (const it of body.cards) for (let i = 0; i < it.count; i++) flatOthers.push(it.cardId);
    const others20 = (flatOthers.slice(0, 20) as (number | null)[])
      .concat(Array(20).fill(null))
      .slice(0, 20);

    // ตรวจสต็อกจาก user_inventory
    const neededIds = [
      ...new Set([...body.characters, ...body.cards.map((c) => c.cardId)]),
    ];
    if (neededIds.length) {
      const inv = await supa
        .from("user_inventory")
        .select("card_id, qty")
        .eq("user_id", body.userId)
        .in("card_id", neededIds);

      if (inv.error) throw inv.error;

      const stock = new Map<number, number>();
      (inv.data ?? []).forEach((r) => stock.set(Number(r.card_id), Number(r.qty)));

      const uniq = new Set(body.characters);
      if (uniq.size !== body.characters.length) {
        return NextResponse.json({ error: "duplicate characters" }, { status: 400 });
      }
      for (const cid of body.characters) {
        if ((stock.get(cid) || 0) < 1) {
          return NextResponse.json({ error: "character not owned" }, { status: 400 });
        }
      }
      for (const it of body.cards) {
        if (it.count < 0) return NextResponse.json({ error: "bad count" }, { status: 400 });
        if (it.count > (stock.get(it.cardId) || 0)) {
          return NextResponse.json({ error: "exceed inventory" }, { status: 400 });
        }
      }
    }

    // หา active deck ของ user
    const existing = await supa
      .from("decks")
      .select("id")
      .eq("user_id", body.userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;

    const payload: Record<string, unknown> = {
      name: body.name,
      card_char1: chars3[0],
      card_char2: chars3[1],
      card_char3: chars3[2],
      is_active: true,
    };
    for (let i = 0; i < 20; i++) payload[`card${i + 1}`] = others20[i];

    if (existing.data) {
      const upd = await supa.from("decks").update(payload).eq("id", existing.data.id).select("id").single();
      if (upd.error) throw upd.error;
      return NextResponse.json({ ok: true, deckId: Number(upd.data.id) });
    } else {
      const ins = await supa
        .from("decks")
        .insert([{ user_id: body.userId, created_at: new Date().toISOString(), ...payload }])
        .select("id")
        .single();
      if (ins.error) throw ins.error;
      return NextResponse.json({ ok: true, deckId: Number(ins.data.id) });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
