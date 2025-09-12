// src/app/api/gacha/wish/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===================== CONFIG =====================
   ★★★★★ (ตัวละคร) – pity 80 (hard), soft เริ่ม 60
   ★★★★ (support/event)
   5★ → 50/50 หน้าตู้ vs หลุดเรต (9 ตัว)
   แก้อัตรา/รายการได้สะดวกที่บล็อกนี้
==================================================== */

const BASE_5_RATE = 0.006;      // 0.6%
const SOFT_START = 60;           // เริ่ม soft pity ที่ roll #60
const HARD_PITY  = 80;           // roll ครบ 80 → การันตี 5★

type PoolChar = { kind: "char"; id: number; rate: number };
type PoolCard = { kind: "card"; id: number; rate: number };

const POOL_5_FEATURED: PoolChar[] = [
  // ตัวหน้าตู้ (ตัวอย่าง id=4)
  { kind: "char", id: 4, rate: 1 },
];

const POOL_5_OFF_RATE: PoolChar[] = [
  // 9 ตัวหลุดเรต (แก้ id ให้ตรงเกมจริง)
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

const POOL_4_SUPPORTS: PoolCard[] = [
  // support/event 4★
  { kind: "card", id: 1, rate: 30 },
  { kind: "card", id: 2, rate: 30 },
  { kind: "card", id: 3, rate: 30 },
];

type WishBody = { userId: number; count: 1 | 10; autoExchangeIfNeed?: boolean };
type Result =
  | { kind: "char"; id: number; rarity: 5 }
  | { kind: "card"; id: number; rarity: 4 };

/* ===================== helpers ===================== */
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

/** ให้โอกาส 5★ ที่ pity = p (0-based, แปลว่าหลังไม่ออก 5★ มาแล้ว p ครั้ง) */
function fiveRateAtPity(pity: number): number {
  if (pity >= HARD_PITY - 1) return 1; // กลายเป็นการันตีใน roll ถัดไป
  if (pity < SOFT_START) return BASE_5_RATE;
  // soft ramp แบบ linear ให้ไปแตะ ~32% ที่ pity=79
  const steps = (HARD_PITY - 1) - SOFT_START + 1; // 79-60+1 = 20
  const targetAt79 = 0.32;
  const stepInc = (targetAt79 - BASE_5_RATE) / steps;
  const idx = pity - SOFT_START + 1; // 1..20
  return Math.min(targetAt79, BASE_5_RATE + stepInc * idx);
}

function pickFiveStar(): Result {
  const pickFeatured = Math.random() < 0.5; // 50/50
  const pool = pickFeatured ? POOL_5_FEATURED : POOL_5_OFF_RATE;
  const chosen = pickWeighted(pool);
  return { kind: "char", id: chosen.id, rarity: 5 };
}
function pickFourStar(): Result {
  const chosen = pickWeighted(POOL_4_SUPPORTS);
  return { kind: "card", id: chosen.id, rarity: 4 };
}

/** roll 1 ครั้งตาม pity (pity คือจำนวน "ครั้งที่ไม่ออก 5★ ติดต่อกัน") */
function rollOneWithPity(pity: number): { result: Result; nextPity: number } {
  const prob5 = fiveRateAtPity(pity);
  const isFive = Math.random() < prob5;
  if (isFive) {
    return { result: pickFiveStar(), nextPity: 0 };
  }
  return { result: pickFourStar(), nextPity: pity + 1 };
}

function rollManyWithPity(n: number, pity: number): { results: Result[]; pityOut: number } {
  const out: Result[] = [];
  let p = pity;
  for (let i = 0; i < n; i++) {
    const { result, nextPity } = rollOneWithPity(p);
    out.push(result);
    p = nextPity;
  }
  return { results: out, pityOut: p };
}

/* ===================== wallet/inventory ===================== */
async function getUserWalletAndPity(userId: number): Promise<{ point: number; deal: number; pity5: number }> {
  const sel = await supa
    .from("users")
    .select("id,nexus_point,nexus_deal,wish_pity5")
    .eq("id", userId)
    .maybeSingle();
  if (sel.error) throw new Error(sel.error.message);
  const row = (sel.data || {}) as { nexus_point?: number; nexus_deal?: number; wish_pity5?: number };
  return {
    point: row.nexus_point ?? 0,
    deal: row.nexus_deal ?? 0,
    pity5: row.wish_pity5 ?? 0,
  };
}

async function setUserWalletAndPity(userId: number, point: number, deal: number, pity5: number) {
  const upd = await supa
    .from("users")
    .update({ nexus_point: point, nexus_deal: deal, wish_pity5: pity5 })
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (upd.error) throw new Error(upd.error.message);
}

async function upsertInventory(userId: number, items: Result[]) {
  const inv = await supa
    .from("inventorys")
    .select(
      "id,user_id,char_1,char_2,char_3,char_4,char_5,char_6,char_7,char_8,char_9,char_10,char_11,char_12,card_1,card_2,card_3"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (inv.error) throw new Error(inv.error.message);

  const row = (inv.data || { user_id: userId }) as Record<string, unknown>;
  const next: Record<string, number> = {};

  const get = (k: string) => Number(row[k] ?? 0);
  const add = (k: string) => (next[k] = (next[k] ?? get(k)) + 1);

  for (const it of items) {
    if (it.kind === "char" && it.id >= 0 && it.id <= 12) add(`char_${it.id}`);
    if (it.kind === "card" && it.id >= 1 && it.id <= 3) add(`card_${it.id}`);
  }

  // combine ค่าเดิม + เพิ่ม
  const payload: Record<string, number> = {};
  for (let i = 1; i <= 12; i++) payload[`char_${i}`] = next[`char_${i}`] ?? get(`char_${i}`);
  for (let i = 1; i <= 3; i++) payload[`card_${i}`] = next[`card_${i}`] ?? get(`card_${i}`);

  if (!inv.data) {
    const ins = await supa.from("inventorys").insert([{ user_id: userId, ...payload }]).select("id").maybeSingle();
    if (ins.error) throw new Error(ins.error.message);
  } else {
    const invId = (inv.data as { id: number }).id;
    const upd = await supa.from("inventorys").update(payload).eq("id", invId).select("id").maybeSingle();
    if (upd.error) throw new Error(upd.error.message);
  }
}

/* ===================== handler ===================== */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as WishBody;
    const { userId, count, autoExchangeIfNeed } = body;
    if (!userId || (count !== 1 && count !== 10)) {
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }

    // 1) โหลดกระเป๋า + pity (แยก const/let ให้ผ่าน prefer-const)
    const wallet = await getUserWalletAndPity(userId);
    let point = wallet.point;
    let deal  = wallet.deal;
    const pity5 = wallet.pity5;

    // 2) ใช้ Nexus Deal / แลกอัตโนมัติถ้าต้องการ
    const need = count - deal;
    if (need > 0 && autoExchangeIfNeed) {
      const EXCHANGE_RATE = 10; // 10 point → 1 deal
      const needPoint = need * EXCHANGE_RATE;
      if (point >= needPoint) {
        point -= needPoint;
        deal += need;
      }
    }
    if (deal < count) {
      return NextResponse.json({ error: "Nexus Deal ไม่พอ (และไม่ได้แลกเพิ่ม)" }, { status: 400 });
    }
    deal -= count;

    // 3) roll ด้วย pity
    const { results, pityOut } = rollManyWithPity(count, pity5);

    // 4) +inventory
    await upsertInventory(userId, results);

    // 5) อัปเดตกระเป๋า + pity
    await setUserWalletAndPity(userId, point, deal, pityOut);

    return NextResponse.json({
      ok: true,
      spentDeals: count,
      wallet: { nexusPoint: point, nexusDeal: deal },
      pity5: pityOut,
      results,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
