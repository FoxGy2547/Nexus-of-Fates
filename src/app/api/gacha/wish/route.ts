// src/app/api/gacha/wish/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =====================================================
   :sparkles: GACHA CONFIG — ไม่มี 3 ดาวแล้ว เหลือแค่ 4★ / 5★ :sparkles:

   RARITY รวม (ก่อน pity):
   - 5★ = 0.6%
   - 4★ = ที่เหลือทั้งหมด (เพราะไม่มี 3★ แล้ว)

   5★ PITY:
   - SOFT PITY เริ่มครั้งที่ 60 → เพิ่มโอกาส 5★ +2% ต่อครั้ง
   - HARD PITY ที่ครั้งที่ 80 → การันตี 5★

   5★ แบ่งพูล 50/50:
   - Featured (หน้าตู้)  → POOL_5_FEATURED
   - Off-rate (หลุดเรต 9 ตัว) → POOL_5_OFF_RATE

   4★:
   - Support/Event เท่านั้น → POOL_4_SUPPORTS

   ▼ ตัวอย่างคอนฟิกที่แก้ได้ชัด ๆ
   5★ Featured:
     char id 4  rate 0.4

   5★ Off-rate (ควรใส่ครบ 9 ตัว 9 ธาตุ):
     char id 1  rate 1
     char id 2  rate 1
     char id 3  rate 1
     char id 5  rate 1
     char id 6  rate 1
     char id 7  rate 1
     char id 8  rate 1
     char id 9  rate 1
     char id 10 rate 1

   4★ Supports/Events:
     card id 1 rate 30
     card id 2 rate 30
     card id 3 rate 30
   ===================================================== */
   
// อัตราแลก Nexus Point → Nexus Deal
const EXCHANGE_RATE = 10;
const HARD_PITY_5 = 80;
const SOFT_PITY_5_START = 60;
const SOFT_PITY_5_STEP = 0.02;
const BASE_FIVE_RATE = 0.006;

type PoolChar = { kind: "char"; id: number; rate: number };
type PoolCard = { kind: "card"; id: number; rate: number };

// ★★★★★
const POOL_5_FEATURED: PoolChar[] = [{ kind: "char", id: 4, rate: 0.4 }];
const POOL_5_OFF_RATE: PoolChar[] = [
  { kind: "char", id: 1, rate: 1 },
  { kind: "char", id: 2, rate: 1 },
  { kind: "char", id: 3, rate: 1 },
  { kind: "char", id: 5, rate: 1 },
  { kind: "char", id: 6, rate: 1 },
  { kind: "char", id: 7, rate: 1 },
  { kind: "char", id: 8, rate: 1 },
  { kind: "char", id: 9, rate: 1 },
  { kind: "char", id: 10, rate: 1 },
];

// ★★★★
const POOL_4_SUPPORTS: PoolCard[] = [
  { kind: "card", id: 1, rate: 30 },
  { kind: "card", id: 2, rate: 30 },
  { kind: "card", id: 3, rate: 30 },
];

type WishBody = { userId: number; count: 1 | 10; autoExchangeIfNeed?: boolean };
type Result =
  | { kind: "char"; id: number; rarity: 5 }
  | { kind: "card"; id: number; rarity: 4 };

/* ---------------- helpers (เหมือนเดิม) ---------------- */
function pickWeighted<T extends { rate: number }>(arr: T[]): T {
  const total = arr.reduce((a, b) => a + (b.rate || 0), 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const it of arr) {
    acc += it.rate;
    if (r <= acc) return it;
  }
  return arr[arr.length - 1];
}

function dynamicFiveRate(pity5: number): number {
  if (pity5 >= HARD_PITY_5 - 1) return 1;
  if (pity5 + 1 < SOFT_PITY_5_START) return BASE_FIVE_RATE;
  const steps = pity5 + 1 - SOFT_PITY_5_START + 1;
  const boosted = BASE_FIVE_RATE + steps * SOFT_PITY_5_STEP;
  return Math.min(1, boosted);
}

function drawRarity(pity5: number): 4 | 5 {
  const p5 = dynamicFiveRate(pity5);
  return Math.random() < p5 ? 5 : 4;
}

function pickFiveStar(): Result {
  const pickFeatured = Math.random() < 0.5;
  const pool =
    pickFeatured && POOL_5_FEATURED.length
      ? POOL_5_FEATURED
      : POOL_5_OFF_RATE.length
      ? POOL_5_OFF_RATE
      : POOL_5_FEATURED.length
      ? POOL_5_FEATURED
      : POOL_5_OFF_RATE;
  const chosen = pickWeighted(pool);
  return { kind: "char", id: chosen.id, rarity: 5 };
}
function pickFourStar(): Result {
  const chosen = pickWeighted(POOL_4_SUPPORTS);
  return { kind: "card", id: chosen.id, rarity: 4 };
}

function rollOneWithPity(pity5: number): { result: Result; nextPity5: number } {
  const rarity = drawRarity(pity5);
  if (rarity === 5) return { result: pickFiveStar(), nextPity5: 0 };
  return { result: pickFourStar(), nextPity5: pity5 + 1 };
}
function rollTen(pity5: number): { results: Result[]; nextPity5: number } {
  let next = pity5;
  const results: Result[] = [];
  for (let i = 0; i < 10; i++) {
    const { result, nextPity5 } = rollOneWithPity(next);
    results.push(result);
    next = nextPity5;
  }
  return { results, nextPity5: next };
}

/* ---------------- wallet/pity/inventory ---------------- */
async function getWallet(userId: number): Promise<{ nexusPoint: number; nexusDeal: number }> {
  const sel = await supa.from("users").select("id,nexus_point,nexus_deal").eq("id", userId).maybeSingle();
  if (sel.error) throw new Error(sel.error.message);
  if (!sel.data) return { nexusPoint: 0, nexusDeal: 0 };
  const row = sel.data as { nexus_point?: number; nexus_deal?: number };
  return { nexusPoint: row.nexus_point ?? 0, nexusDeal: row.nexus_deal ?? 0 };
}
async function setWallet(userId: number, point: number, deal: number) {
  const upd = await supa.from("users").update({ nexus_point: point, nexus_deal: deal }).eq("id", userId).select("id").maybeSingle();
  if (upd.error) throw new Error(upd.error.message);
}
async function getPity5(userId: number): Promise<number> {
  const sel = await supa.from("users").select("id,wish_pity5").eq("id", userId).maybeSingle();
  if (sel.error) throw new Error(sel.error.message);
  if (!sel.data) return 0;
  const row = sel.data as { wish_pity5?: number };
  return Number(row.wish_pity5 ?? 0) || 0;
}
async function setPity5(userId: number, pity: number) {
  const upd = await supa.from("users").update({ wish_pity5: pity }).eq("id", userId).select("id").maybeSingle();
  if (upd.error) throw new Error(upd.error.message);
}

async function addInventory(userId: number, items: Result[]) {
  const inv = await supa
    .from("inventorys")
    .select(
      "id,user_id,char_1,char_2,char_3,char_4,char_5,char_6,char_7,char_8,char_9,char_10,char_11,char_12,card_1,card_2,card_3"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (inv.error) throw new Error(inv.error.message);

  const row = (inv.data || { user_id: userId }) as Record<string, unknown>;
  const patch: Record<string, number> = {};

  const inc = (k: string) => {
    const prev = Number((patch[k] ?? row[k]) ?? 0);
    patch[k] = prev + 1;
  };

  for (const it of items) {
    if (it.kind === "char" && it.id >= 0 && it.id <= 12) inc(`char_${it.id}`);
    if (it.kind === "card" && it.id >= 1 && it.id <= 3) inc(`card_${it.id}`);
  }

  const payload: Record<string, number> = {};
  for (let i = 1; i <= 12; i++) payload[`char_${i}`] = Number(patch[`char_${i}`] ?? row[`char_${i}`] ?? 0);
  for (let i = 1; i <= 3; i++) payload[`card_${i}`] = Number(patch[`card_${i}`] ?? row[`card_${i}`] ?? 0);

  if (!inv.data) {
    const ins = await supa.from("inventorys").insert([{ user_id: userId, ...payload }]).select("id").maybeSingle();
    if (ins.error) throw new Error(ins.error.message);
  } else {
    // ✅ เปลี่ยน cast ให้ชัด ไม่ใช้ any
    const invId = (inv.data as { id: number }).id;
    const upd = await supa.from("inventorys").update(payload).eq("id", invId).select("id").maybeSingle();
    if (upd.error) throw new Error(upd.error.message);
  }
}

/* ---------------- handler ---------------- */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as WishBody;
    const { userId, count, autoExchangeIfNeed } = body;
    if (!userId || (count !== 1 && count !== 10)) {
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }

    let { nexusPoint, nexusDeal } = await getWallet(userId);

    if (nexusDeal < count && autoExchangeIfNeed) {
      const need = count - nexusDeal;
      const needPts = need * EXCHANGE_RATE;
      if (nexusPoint >= needPts) {
        nexusPoint -= needPts;
        nexusDeal += need;
      }
    }
    if (nexusDeal < count) {
      return NextResponse.json({ error: "Nexus Deal ไม่พอ (และไม่ได้แลกเพิ่ม)" }, { status: 400 });
    }

    nexusDeal -= count;

    let pity5 = await getPity5(userId);

    let results: Result[] = [];
    if (count === 10) {
      const r = rollTen(pity5);
      results = r.results;
      pity5 = r.nextPity5;
    } else {
      const r = rollOneWithPity(pity5);
      results = [r.result];
      pity5 = r.nextPity5;
    }

    await addInventory(userId, results);
    await setWallet(userId, nexusPoint, nexusDeal);
    await setPity5(userId, pity5);

    return NextResponse.json({
      ok: true,
      spentDeals: count,
      wallet: { nexusPoint, nexusDeal },
      pity5,
      results,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
