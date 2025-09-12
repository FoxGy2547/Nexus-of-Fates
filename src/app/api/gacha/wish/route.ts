import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";
import { POOLS, PoolItem } from "./pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================= types ============================= */
type WishBody = {
  userId: number;
  times: 1 | 10;
  // ถ้า deals ไม่พอและตั้ง true จะเอา Nexus Point มาแลกเพิ่มให้อัตโนมัติ
  autoConvertNP?: boolean;
};

type UserRow = {
  id: number;
  nexus_point: number | null;
  nexus_deal: number | null;
  wish_pity5: number | null; // pity นับตั้งแต่ได้ 5★ ล่าสุด
};

type InvRow = Partial<Record<`char_${number}`, number>> &
  Partial<Record<`card_${number}`, number>> & {
    user_id: number;
  };

type WishResultItem = {
  rarity: 3 | 4 | 5;
  id: number;
  code: string;
  name: string;
  kind: "character" | "support" | "event";
  artUrl: string;
};

/* =========================== config ============================ */
// เรตพื้นฐาน
const rate = {
  fiveBase: 0.006, // 0.6%
  fourBase: 0.051, // 5.1%
  softFrom: 60, // เริ่ม soft pity ที่ 60
  hardAt: 80, // เข้า hard pity ที่ 80 (บังคับ 5★)
  fourGuaranteeSpan: 10, // การันตี 4★ ทุก ๆ 10 ครั้ง
};

// ความชัน soft pity (เพิ่มโอกาส 5★ ทีละนิดจนถึง hardAt)
function fiveChanceWithPity(pity5: number): number {
  if (pity5 + 1 >= rate.hardAt) return 1;
  if (pity5 + 1 < rate.softFrom) return rate.fiveBase;
  const steps = rate.hardAt - rate.softFrom; // 20
  const progress = pity5 + 1 - rate.softFrom; // 0..steps-1
  // เพิ่มความชันแบบนุ่ม ๆ ให้ขึ้นถึงใกล้ 100% ตอนแตะ hardAt
  const extra = (0.9 / Math.max(1, steps)) * progress; // +0..0.9
  return Math.min(1, rate.fiveBase + extra);
}

const NP_PER_DEAL = 1; // อัตราแลก Nexus Point -> Nexus Deal (ปรับได้)

/* ========================= helpers ========================= */
function rnd(): number {
  return Math.random();
}

function pickOne<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function pick5Star(): PoolItem {
  // 50/50 หน้าตู้ / หลุดเรต
  if (rnd() < 0.5 && POOLS.FIVE_FEATURED.length) {
    return pickOne(POOLS.FIVE_FEATURED);
  }
  return pickOne(POOLS.FIVE_OFF.length ? POOLS.FIVE_OFF : POOLS.FIVE_FEATURED);
}

function pick4Star(): PoolItem {
  return pickOne(POOLS.FOUR_POOL);
}

function pick3Star(): PoolItem {
  return pickOne(POOLS.THREE_POOL);
}

/* ====================== DB helpers (typed) ====================== */
async function getUser(userId: number): Promise<UserRow | null> {
  const q = await supa
    .from("users")
    .select("id,nexus_point,nexus_deal,wish_pity5")
    .eq("id", userId)
    .maybeSingle<UserRow>();
  if (q.error) throw new Error(q.error.message);
  return q.data ?? null;
}

async function updateUser(userId: number, patch: Partial<UserRow>): Promise<void> {
  const q = await supa.from("users").update(patch).eq("id", userId);
  if (q.error) throw new Error(q.error.message);
}

async function getInventory(userId: number): Promise<InvRow | null> {
  const q = await supa.from("inventorys").select("*").eq("user_id", userId).maybeSingle<InvRow>();
  if (q.error) throw new Error(q.error.message);
  return q.data ?? null;
}

async function upsertInventory(userId: number, next: InvRow): Promise<void> {
  const q = await supa.from("inventorys").upsert([{ ...next, user_id: userId }], { onConflict: "user_id" });
  if (q.error) throw new Error(q.error.message);
}

/* ============================ GET ============================ */
/** อ่านสถานะกระเป๋ากาชา (ไว้ให้หน้า UI โชว์ หรือจะไม่ใช้ก็ได้) */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? 0);
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }
    const user = await getUser(userId);
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        nexusPoint: Number(user.nexus_point ?? 0),
        nexusDeal: Number(user.nexus_deal ?? 0),
        pity5: Number(user.wish_pity5 ?? 0),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/* ============================ POST =========================== */
/**
 * สุ่มกาชา + อัปเดต user & inventorys
 * body: { userId: number, times: 1|10, autoConvertNP?: boolean }
 */
export async function POST(req: Request) {
  let body: WishBody;
  try {
    body = (await req.json()) as WishBody;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  try {
    const { userId, times, autoConvertNP = false } = body;
    if (!userId || (times !== 1 && times !== 10)) {
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }

    // โหลด user
    const user = await getUser(userId);
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

    let deals = Number(user.nexus_deal ?? 0);
    let np = Number(user.nexus_point ?? 0);
    let pity5 = Number(user.wish_pity5 ?? 0);

    // แลก NP -> Deal ถ้าจำเป็น
    if (deals < times && autoConvertNP && np > 0) {
      const need = times - deals;
      const can = Math.min(need, Math.floor(np / NP_PER_DEAL));
      if (can > 0) {
        np -= can * NP_PER_DEAL;
        deals += can;
      }
    }

    if (deals < times) {
      return NextResponse.json({ error: "not enough deals" }, { status: 400 });
    }

    // เตรียม inventory (อ่านของเดิมก่อน)
    const inv = (await getInventory(userId)) ?? { user_id: userId };

    // ฟังก์ชันปรับค่าใน inv
    const addChar = (id: number, inc = 1) => {
      const key = `char_${id}` as const;
      const current = Number((inv as Record<string, unknown>)[key] ?? 0);
      (inv as Record<string, unknown>)[key] = current + inc;
    };
    const addOther = (slotId: number, inc = 1) => {
      const key = `card_${slotId}` as const; // supports/events ใช้ card_1..card_3
      const current = Number((inv as Record<string, unknown>)[key] ?? 0);
      (inv as Record<string, unknown>)[key] = current + inc;
    };

    // เริ่มสุ่ม
    const results: WishResultItem[] = [];
    let pullsSince4 = 0; // นับเพื่อการันตี 4★ ทุก 10

    for (let i = 0; i < times; i++) {
      // คำนวณเรตตาม pity
      const p5 = fiveChanceWithPity(pity5);
      const p4 = rate.fourBase;

      // การันตี 4★ ทุกๆ 10
      const must4 = pullsSince4 >= rate.fourGuaranteeSpan - 1;

      let got: PoolItem;
      let rarity: 3 | 4 | 5;

      if (pity5 + 1 >= rate.hardAt) {
        got = pick5Star();
        rarity = 5;
      } else {
        const r = rnd();
        if (r < p5) {
          got = pick5Star();
          rarity = 5;
        } else if (must4 || r < p5 + p4) {
          got = pick4Star();
          rarity = 4;
        } else {
          got = pick3Star();
          rarity = 3;
        }
      }

      // อัปเดตตัวนับ pity และ guarantee
      if (rarity === 5) {
        pity5 = 0;
        pullsSince4 = 0;
      } else {
        pity5 += 1;
        pullsSince4 = rarity === 4 ? 0 : pullsSince4 + 1;
      }

      // บันทึกผล + อัปเดต inventory
      results.push({
        rarity,
        id: got.id,
        code: got.code,
        name: got.name,
        kind: got.kind,
        artUrl: got.artUrl,
      });

      if (got.kind === "character") addChar(got.id, 1);
      else addOther(got.id, 1); // id 1..3 = card_1..card_3
    }

    // ตัด deals
    deals -= times;

    // เซฟ user + inventory
    await updateUser(userId, {
      nexus_point: np,
      nexus_deal: deals,
      wish_pity5: pity5,
    });

    await upsertInventory(userId, inv);

    return NextResponse.json({
      ok: true,
      items: results,
      user: { nexusPoint: np, nexusDeal: deals, pity5 },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
