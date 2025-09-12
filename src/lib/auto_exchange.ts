// src/lib/auto_exchange.ts
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const supa = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
  auth: { persistSession: false },
});

const LIMIT = 20; // เก็บได้สูงสุด (เฉพาะ card_*)
const RATE  = 3;  // ส่วนเกิน 3 ใบ = 1 Nexus Point

// นับเฉพาะการ์ด support/event ที่ขึ้นต้นด้วย card_ (ไม่ยุ่งกับ char_*)
const isCard = (code: string) => code.startsWith("card_");

export async function autoExchangeCards(params: {
  userId: number;
  grants: Array<{ code: string; qty: number }>;
}) {
  const { userId, grants } = params;
  let totalGainedNP = 0;

  for (const g of grants) {
    const code = g.code;
    const add  = Math.max(0, Math.floor(g.qty || 0));
    if (!add) continue;

    const { data: row } = await supa
      .from("inventories")
      .select("qty")
      .eq("user_id", userId)
      .eq("code", code)
      .maybeSingle();

    const current = row?.qty ?? 0;
    let after = current + add;

    if (isCard(code) && after > LIMIT) {
      const excess = after - LIMIT;
      const gained = Math.floor(excess / RATE);
      const keep   = LIMIT + (excess % RATE); // เก็บเศษ 1–2 ไว้ รอรอบหน้าครบ 3 ค่อยแปลง
      totalGainedNP += gained;
      after = keep;
    }

    await supa.from("inventories").upsert(
      { user_id: userId, code, qty: after },
      { onConflict: "user_id,code" }
    );
  }

  if (totalGainedNP > 0) {
    // อ่านค่าเดิม (กัน null) แล้ว + เพิ่ม
    const { data } = await supa
      .from("users")
      .select("nexus_point")
      .eq("id", userId)
      .maybeSingle();
    const cur = (data?.nexus_point ?? 0) as number;
    await supa.from("users").update({ nexus_point: cur + totalGainedNP }).eq("id", userId);
  }

  return { gainedNP: totalGainedNP };
}

// ถ้าก่อนหน้านี้มีโค้ดเรียกชื่อเดิมอยู่ จะ re-export ไว้ให้ด้วย
export const awardCardsAndConvert = autoExchangeCards;
