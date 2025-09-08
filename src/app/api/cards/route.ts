import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

/* ===== types ===== */
type CardRow = {
  code: string;
  name: string;
  element: string;
  attack: number;
  hp: number;
  ability: string;
  cost: number;
  type: string | null;
  rarity: string | null;
  role: string | null;
  image: string | null;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===== in-memory cache (ข้าม hot-reload) ===== */
declare global {
  // eslint-disable-next-line no-var
  var __CARDS_ALL__: Record<string, CardRow> | undefined;
  // eslint-disable-next-line no-var
  var __CARDS_AT__: number | undefined;
  // eslint-disable-next-line no-var
  var __CARDS_LOADING__: Promise<Record<string, CardRow>> | undefined;
  // eslint-disable-next-line no-var
  var __CARDS_ERR_AT__: number | undefined;
}
const TTL = 60_000;        // 60s
const BACKOFF = 15_000;    // ถ้าเพิ่ง error ให้รอ 15s ก่อนลองใหม่

function now() { return Date.now(); }

async function loadAllFromDB(): Promise<Record<string, CardRow>> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`
    SELECT
      code, name, element,
      attack, hp, ability, cost,
      type, rarity, role, image
    FROM cards
    ORDER BY id ASC
  `);

  const map: Record<string, CardRow> = {};
  for (const r of rows ?? []) {
    map[String(r.code)] = {
      code: String(r.code),
      name: String(r.name ?? r.code),
      element: String(r.element ?? "Neutral"),
      attack: Number(r.attack ?? 0),
      hp: Number(r.hp ?? 0),
      ability: String(r.ability ?? ""),
      cost: Number(r.cost ?? 0),
      type: r.type ?? null,
      rarity: r.rarity ?? null,
      role: r.role ?? null,
      image: r.image ?? null,
    };
  }
  return map;
}

async function getAllCards(): Promise<Record<string, CardRow>> {
  const t = now();

  // serve cache ถ้ายังสด
  if (global.__CARDS_ALL__ && global.__CARDS_AT__ && t - global.__CARDS_AT__ < TTL) {
    return global.__CARDS_ALL__;
  }

  // backoff ถ้าเพิ่งพัง
  if (global.__CARDS_ERR_AT__ && t - global.__CARDS_ERR_AT__ < BACKOFF) {
    if (global.__CARDS_ALL__) return global.__CARDS_ALL__;
    throw new Error("backoff-no-cache");
  }

  // ถ้ากำลังโหลดอยู่ ให้รอ Promise เดิม (กันยิงซ้ำ)
  if (global.__CARDS_LOADING__) {
    return global.__CARDS_LOADING__;
  }

  global.__CARDS_LOADING__ = (async () => {
    try {
      const data = await loadAllFromDB();
      global.__CARDS_ALL__ = data;
      global.__CARDS_AT__ = now();
      return data;
    } catch (e) {
      global.__CARDS_ERR_AT__ = now();
      throw e;
    } finally {
      global.__CARDS_LOADING__ = undefined;
    }
  })();

  return global.__CARDS_LOADING__;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const codesParam = url.searchParams.get("codes");
    const want = (codesParam || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let all: Record<string, CardRow> | null = null;
    try {
      all = await getAllCards(); // อาจ throw
    } catch (e) {
      console.error("[api/cards] loadAllCards failed:", e);
      // เสิร์ฟจาก cache เดิมถ้ามี
      if (global.__CARDS_ALL__) all = global.__CARDS_ALL__;
    }

    const list: CardRow[] = [];
    if (all) {
      if (want.length) {
        for (const c of want) if (all[c]) list.push(all[c]);
      } else {
        list.push(...Object.values(all));
      }
    }

    // ถ้าไม่มีข้อมูลเลย คงต้องให้ client fallback ทำงานต่อ
    return NextResponse.json({ ok: true, cards: list }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "SERVER_ERROR", cards: [] },
      { status: 503 }
    );
  }
}
