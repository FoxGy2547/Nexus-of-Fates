import { NextResponse } from "next/server";
import { createPool } from "@/lib/db";
import type { Pool, RowDataPacket } from "mysql2/promise";

/* Next.js route config */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========= Types ========= */

type Element =
  | "Pyro"
  | "Hydro"
  | "Cryo"
  | "Electro"
  | "Geo"
  | "Anemo"
  | "Quantum"
  | "Imaginary"
  | "Neutral";

export type CardRow = {
  code: string;
  name: string;
  element: Element | "Neutral";
  attack: number;
  hp: number;
  ability: string;
  cost: number;
  type: string | null;
  rarity: string | null;
  role: string | null;
  image: string | null;
};

type CardRowDB = RowDataPacket & {
  id: number;
  code: string;
  name: string;
  element: Element | null;
  attack: number | null;
  hp: number | null;
  ability: string | null;
  cost: number | null;
  type: string | null;
  rarity: string | null;
  role: string | null;
  image: string | null;
};

type CardsMap = Record<string, CardRow>;

/* ========= Connection pool (cache) ========= */

let poolPromise: Promise<Pool> | null = null;
function getPool(): Promise<Pool> {
  if (!poolPromise) poolPromise = createPool();
  return poolPromise!;
}

/* ========= In-memory cache ========= */

const CACHE_TTL_MS = 60_000; // 60s
let cardsCache: { at: number; map: CardsMap } | null = null;

function now(): number {
  return Date.now();
}

function normalizeRow(r: CardRowDB): CardRow {
  return {
    code: String(r.code),
    name: String(r.name ?? r.code ?? ""),
    element: (r.element ?? "Neutral") as Element | "Neutral",
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

/** โหลดการ์ดทั้งหมดจาก DB เป็น map[code] */
async function loadAllFromDB(): Promise<CardsMap> {
  const pool = await getPool();

  const sql = `
    SELECT
      id, code, name, element,
      attack, hp, ability, cost, type, rarity, role, image
    FROM cards
    ORDER BY id ASC
  `;

  const [rows] = await pool.execute<CardRowDB[]>(sql);

  const map: CardsMap = {};
  for (const r of rows ?? []) {
    const code = String(r.code);
    map[code] = normalizeRow(r);
  }
  return map;
}

/** ให้แหล่งข้อมูลการ์ด (โหลด DB เมื่อ cache หมดอายุ) */
async function getCardsMap(): Promise<CardsMap> {
  const fresh = cardsCache && now() - cardsCache.at < CACHE_TTL_MS;
  if (fresh && cardsCache) return cardsCache.map;

  try {
    const map = await loadAllFromDB();
    cardsCache = { at: now(), map };
    return map;
  } catch {
    // DB ล่ม → ถ้ามี cache เดิมให้ใช้ไปก่อน
    if (cardsCache) return cardsCache.map;
    // ไม่มี cache เลย → คืนว่าง
    return {};
  }
}

/* ========= GET handler =========
   - /api/cards                -> การ์ดทั้งหมด
   - /api/cards?codes=A,B,C    -> เฉพาะ code ที่ขอ (คั่น ,)
*/
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const codesParam = url.searchParams.get("codes");

    const map = await getCardsMap();

    let cards: CardRow[];

    if (codesParam && codesParam.trim().length > 0) {
      const wanted = codesParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      cards = wanted.map((c) => {
        const found = map[c];
        // ถ้าไม่พบใน DB ให้ทำ fallback card เปล่า ๆ ด้วยชื่ออ่านง่าย
        if (!found) {
          const pretty = c.replaceAll("_", " ");
          return {
            code: c,
            name: pretty,
            element: "Neutral",
            attack: 0,
            hp: 0,
            ability: "",
            cost: 0,
            type: null,
            rarity: null,
            role: null,
            image: null,
          } satisfies CardRow;
        }
        return found;
      });
    } else {
      cards = Object.values(map);
    }

    return NextResponse.json(
      {
        ok: true,
        count: cards.length,
        cards,
        cacheAgeMs: cardsCache ? now() - cardsCache.at : null,
      },
      { status: 200 }
    );
  } catch (e) {
    // ถ้าเกิด error หนัก ๆ ก็คืน minimal payload เพื่อไม่ให้หน้าเพลย์พัง
    return NextResponse.json(
      { ok: false, error: "CARDS_FETCH_FAILED", cards: [] as CardRow[] },
      { status: 503 }
    );
  }
}
