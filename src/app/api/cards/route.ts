import { NextResponse } from "next/server";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";

/** Next.js route config */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===================== Types ===================== */
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

type CardRowDB = RowDataPacket & {
  code: string;
  name: string | null;
  element: Element | null;
  attack: number | null;
  hp: number | null;
  ability: string | null;
  cost: number | null;
  type: string | null;
  rarity: string | null;
  role: string | null;
};

export type CardRow = {
  code: string;
  name: string;
  element: Element;
  attack: number;
  hp: number;
  ability: string;
  cost: number;
  type: string | null;
  rarity?: string | null;
  role?: string | null;
  /** path รูป (ใช้ชื่อจากคอลัมน์ name) */
  image: string;
};

/* ===================== In-memory cache ===================== */
let cacheByCode: Record<string, CardRow> = {};
let cacheLoadedAt = 0;
const TTL_MS = 60_000; // 60s

function now(): number {
  return Date.now();
}

/* แปลงค่า DB → รูปแบบที่ส่งให้ client */
function normalizeRow(r: CardRowDB): CardRow {
  const safeName = (r.name ?? r.code).trim();
  return {
    code: String(r.code),
    name: safeName,
    element: (r.element ?? "Neutral") as Element,
    attack: Number(r.attack ?? 0),
    hp: Number(r.hp ?? 0),
    ability: r.ability ?? "",
    cost: Number(r.cost ?? 0),
    type: r.type ?? null,
    rarity: r.rarity ?? null,
    role: r.role ?? null,
    image: `/cards/${safeName}.png`, // ใช้ชื่อจากคอลัมน์ name ตามที่ต้องการ
  };
}

/** โหลดการ์ดทั้งหมดจากฐานข้อมูล (ใส่ cache) */
async function loadAllFromDB(): Promise<Record<string, CardRow>> {
  const pool: Pool = await getPool();

  const sql = `
    SELECT
      code, name, element,
      attack, hp, ability, cost,
      type, rarity, role
    FROM cards
    ORDER BY id ASC
  `;

  const [rows] = await pool.query<CardRowDB[]>(sql);

  const map: Record<string, CardRow> = {};
  for (const r of rows ?? []) {
    const code = String(r.code);
    map[code] = normalizeRow(r);
  }
  return map;
}

/** ดึงข้อมูลจาก cache (ถ้าเก่าเกิน TTL จะโหลดใหม่) */
async function ensureCache(): Promise<void> {
  const fresh = now() - cacheLoadedAt < TTL_MS && Object.keys(cacheByCode).length > 0;
  if (fresh) return;

  try {
    cacheByCode = await loadAllFromDB();
    cacheLoadedAt = now();
  } catch (err) {
    // ถ้าดึง DB ไม่ได้ ให้คง cache เดิม (หรือว่าง) แต่ไม่ throw เพื่อไม่ให้เว็บพัง
    console.warn("[api/cards] loadAllCards failed:", err);
  }
}

/** เลือกเฉพาะรหัสที่ต้องการ (ถ้าไม่ส่ง codes → ส่งทั้งหมด) */
function pickByCodes(codesCSV: string | null): CardRow[] {
  if (!codesCSV) return Object.values(cacheByCode);

  const wanted = Array.from(
    new Set(
      codesCSV
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );

  const out: CardRow[] = [];
  for (const c of wanted) {
    const row = cacheByCode[c];
    if (row) out.push(row);
  }
  return out;
}

/* ===================== GET Handler ===================== */
export async function GET(req: Request) {
  try {
    await ensureCache();

    const url = new URL(req.url);
    const codesCSV = url.searchParams.get("codes");

    const cards = pickByCodes(codesCSV);

    return NextResponse.json(
      {
        ok: true,
        count: cards.length,
        cards,
      },
      { status: 200 }
    );
  } catch (err) {
    // ถ้าเกิดเหตุการณ์ไม่คาดฝัน ให้ตอบกลับ ok:false แต่ไม่ปล่อย throw
    console.warn("[api/cards] GET error:", err);
    return NextResponse.json(
      { ok: false, cards: [] as CardRow[] },
      { status: 200 }
    );
  }
}