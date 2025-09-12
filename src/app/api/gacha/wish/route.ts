// src/app/api/gacha/wish/route.ts
import { NextResponse } from "next/server";
import { supa } from "@/lib/supabase";
import cardsDataJson from "@/data/cards.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========================== types ========================== */
type WishItem = {
  id: number;
  code: string;
  name?: string | null;
  art: string; // ชื่อไฟล์ตรงกับ public/*
  kind: "character" | "support" | "event";
  rarity: 3 | 4 | 5;
};

type MeWallet = {
  nexusPoint: number;
  nexusDeal: number;
  pity5: number;
  guarantee5: boolean;
};

type PostBody = {
  userId: number;
  times: 1 | 10;
  autoConvertNP?: boolean;
};

/* ========================= cards pools ========================= */
type CardsData = typeof cardsDataJson;
const CD = cardsDataJson as CardsData;

const CHAR_POOL = CD.characters.map((c) => ({
  id: Number(c.char_id),
  code: c.code,
  name: c.name,
  art: c.art, // เช่น "Windblade Duelist.png"
  kind: "character" as const,
}));

// รวม supports + events เข้าด้วยกัน (อิง id 1..3 ตาม inventory: card_1..card_3)
const OTHER_POOL = [
  ...CD.supports.map((s) => ({
    id: Number(s.id),
    code: s.code,
    name: s.name,
    art: s.art, // "Healing Amulet.png"
    kind: "support" as const,
  })),
  ...CD.events.map((e) => ({
    id: Number(e.id),
    code: e.code,
    name: e.name,
    art: e.art, // "Fireworks.png"
    kind: "event" as const,
  })),
];

// 5★ แบนเนอร์หลัก (featured) + 5★ หลุดเรต
const FIVE_FEATURED = CHAR_POOL.filter((c) => c.code === "WINDBLADE_DUELIST");
const FIVE_OFF = CHAR_POOL.filter((c) => c.code !== "WINDBLADE_DUELIST");

// 4★/3★ ใช้จาก OTHER_POOL
const FOUR_POOL = OTHER_POOL;
const THREE_POOL = OTHER_POOL;

/* ========================= rates & pity ========================= */
const RATES = {
  fiveBase: 0.006,        // 0.6%
  fourBase: 0.051,        // 5.1%
  fiveSoftFrom: 60,       // soft pity เริ่มที่ 60
  fiveHardAt: 80,         // hard pity 80
  fourGuaranteeSpan: 10,  // การันตี 4★ ทุก ๆ 10
};

function rollRarity(pity5: number, pullsSince4: number): 3 | 4 | 5 {
  // hard pity
  if (pity5 + 1 >= RATES.fiveHardAt) return 5;

  // soft pity ช่วง 60+
  const base5 =
    pity5 + 1 >= RATES.fiveSoftFrom
      ? RATES.fiveBase + (pity5 + 1 - RATES.fiveSoftFrom + 1) * 0.06
      : RATES.fiveBase;

  // การันตี 4★ ทุก 10 ครั้ง
  const must4 = pullsSince4 + 1 >= RATES.fourGuaranteeSpan;

  const r = Math.random();
  if (r < base5) return 5;
  if (must4 || r < base5 + RATES.fourBase) return 4;
  return 3;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ========================= DB helpers ========================= */

async function getWallet(userId: number): Promise<MeWallet> {
  const sel = await supa
    .from("users")
    .select("nexus_point,nexus_deal,wish_pity5,wish_guarantee5")
    .eq("id", userId)
    .maybeSingle();

  if (sel.error || !sel.data) throw new Error(sel.error?.message || "user not found");

  return {
    nexusPoint: Number(sel.data.nexus_point ?? 0),
    nexusDeal: Number(sel.data.nexus_deal ?? 0),
    pity5: Number(sel.data.wish_pity5 ?? 0),
    guarantee5: Boolean(sel.data.wish_guarantee5 ?? false),
  };
}

async function saveWallet(userId: number, w: Partial<MeWallet>) {
  const upd = await supa
    .from("users")
    .update({
      nexus_point: w.nexusPoint,
      nexus_deal: w.nexusDeal,
      wish_pity5: w.pity5,
      wish_guarantee5: w.guarantee5,
    })
    .eq("id", userId);
  if (upd.error) throw new Error(upd.error.message);
}

async function addToInventory(userId: number, it: WishItem) {
  // แปลงเป็น column ของ inventorys
  if (it.kind === "character") {
    const col = `char_${it.id}`;
    await supa.rpc("increment_inventory_column", { p_user_id: userId, p_column: col, p_amount: 1 });
  } else {
    const col = `card_${it.id}`; // 1..3
    await supa.rpc("increment_inventory_column", { p_user_id: userId, p_column: col, p_amount: 1 });
  }
}

/** ตัดยอด Support/Event เมื่อเกิน 20 ใบ แล้วแปลงเป็น NP (3 ใบ = 1 NP) */
async function trimOthersOverflow(userId: number): Promise<{ addedNP: number }> {
  // ดึง inventory แถวเดียวของผู้ใช้
  const sel = await supa
    .from("inventorys")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (sel.error || !sel.data) return { addedNP: 0 };

  const row = sel.data as Record<string, unknown>;
  let addedNP = 0;
  const patch: Record<string, number> = {};

  for (const [key, val] of Object.entries(row)) {
    if (!key.startsWith("card_")) continue;
    const count = Number(val ?? 0);
    if (count > 20) {
      const overflow = count - 20;
      const convert = Math.floor(overflow / 3); // 3 ใบ = 1 NP
      if (convert > 0) {
        addedNP += convert;
        const newCount = count - convert * 3; // ลดทีละ 3 ตามที่แปลง
        patch[key] = newCount;               // อาจเหลือ 21/22 ถ้ายังมีเศษ 1–2 ใบ
      }
    }
  }

  if (Object.keys(patch).length) {
    const upd = await supa.from("inventorys").update(patch).eq("user_id", userId);
    if (upd.error) throw new Error(upd.error.message);
  }

  // ไม่อัปเดต users.nexus_point ตรงนี้ — ให้ผู้เรียกเป็นคนรวมเข้ากับ state แล้ว saveWallet ทีเดียว
  return { addedNP };
}

/* ============================ GET =========================== */
// GET: กระเป๋า (สำหรับโชว์บนหน้า)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = Number(url.searchParams.get("userId") ?? "0");
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: "bad userId" }, { status: 400 });
    }
    const w = await getWallet(userId);
    return NextResponse.json({
      ok: true,
      user: { nexusPoint: w.nexusPoint, nexusDeal: w.nexusDeal, pity5: w.pity5 },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/* ============================ POST ========================== */
// POST: สุ่มกาชา
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PostBody;
    const userId = Number(body?.userId ?? 0);
    const times = body?.times === 10 ? 10 : 1;
    const autoConvertNP = Boolean(body?.autoConvertNP);
    if (!userId || (times !== 1 && times !== 10)) {
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }

    // โหลดกระเป๋า
    const w = await getWallet(userId);

    // แปลง Nexus Point → Nexus Deal อัตโนมัติถ้าจำเป็น
    const needDeals = times;
    if (w.nexusDeal < needDeals && autoConvertNP) {
      const lack = needDeals - w.nexusDeal;
      if (w.nexusPoint >= lack) {
        w.nexusPoint -= lack;
        w.nexusDeal += lack;
      }
    }
    if (w.nexusDeal < needDeals) {
      return NextResponse.json({ error: "not enough Nexus Deal" }, { status: 400 });
    }

    // เริ่มสุ่ม
    const results: WishItem[] = [];
    let pity5 = w.pity5;
    let pullsSince4 = 0;
    let guarantee5 = w.guarantee5;

    for (let i = 0; i < times; i++) {
      const rarity = rollRarity(pity5, pullsSince4);

      if (rarity === 5) {
        // ตัดสิน featured/off ตาม 50/50 + ธง guarantee
        let chosen: typeof CHAR_POOL[number];
        if (guarantee5) {
          chosen = pick(FIVE_FEATURED);
          guarantee5 = false; // ใช้สิทธิ์แล้ว
        } else {
          const onBanner = Math.random() < 0.5;
          chosen = onBanner ? pick(FIVE_FEATURED) : pick(FIVE_OFF);
          if (!onBanner) guarantee5 = true; // หลุดเรต → รอบหน้า 5★ การันตีเข้าตู้
        }

        results.push({ ...chosen, rarity: 5 });
        pity5 = 0;
        pullsSince4 = 0;
      } else if (rarity === 4) {
        const chosen = pick(FOUR_POOL);
        results.push({ ...chosen, rarity: 4 });
        pity5 += 1;
        pullsSince4 = 0;
      } else {
        const chosen = pick(THREE_POOL);
        results.push({ ...chosen, rarity: 3 });
        pity5 += 1;
        pullsSince4 += 1;
      }
    }

    // หักดีลที่ใช้
    w.nexusDeal -= times;

    // เพิ่มของเข้าคลัง
    for (const it of results) {
      await addToInventory(userId, it);
    }

    // ตัดยอด Support/Event เกิน 20 → แปลงเป็น NP (3:1)
    const { addedNP } = await trimOthersOverflow(userId);
    if (addedNP > 0) {
      w.nexusPoint += addedNP;
    }

    // เซฟกระเป๋า (รวม pity/guarantee และ NP ที่ได้จากการตัดยอด)
    await saveWallet(userId, {
      nexusDeal: w.nexusDeal,
      nexusPoint: w.nexusPoint,
      pity5,
      guarantee5,
    });

    return NextResponse.json({
      ok: true,
      items: results,
      user: { nexusPoint: w.nexusPoint, nexusDeal: w.nexusDeal, pity5 },
      bonus: addedNP ? { nexusPointFromTrim: addedNP } : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
