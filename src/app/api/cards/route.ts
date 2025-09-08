import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===== Types ===== */
type Element =
  | "Pyro" | "Hydro" | "Cryo" | "Electro"
  | "Geo" | "Anemo" | "Quantum" | "Imaginary" | "Neutral";

export type CardRow = {
  code: string;
  name: string;
  element: Element;
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
  image: string | null;
};

/* ===== Cache ข้าม hot-reload ===== */
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

const TTL = 60_000;      // 60s
const BACKOFF = 15_000;  // 15s

function now(): number { return Date.now(); }

async function loadAllFromDB(): Promise<Record<string, CardRow>> {
  const pool = getPool();
  const sql = `
    SELECT code, name, element, attack, hp, ability, cost, type, rarity, role, image
    FROM cards
    ORDER BY id ASC
  `;
  const [rows] = await pool.query<CardRowDB[]>(sql);

  const map: Record<string, CardRow> = {};
  for (const r of rows ?? []) {
    const code = String(r.code);
    map[code] = {
      code,
      name: String(r.name ?? code),
      element: (r.element ?? "Neutral") as Element,
      attack: Number(r.attack ?? 0),
      hp: Number(r.hp ?? 0),
      ability: String(r.ability ?? ""),
      cost: Number(r.cost ?? 0),
      type: r.type,
      rarity: r.rarity,
      role: r.role,
      image: r.image,
    };
  }
  return map;
}

async function getAllCards(): Promise<Record<string, CardRow>> {
  const t = now();

  if (global.__CARDS_ALL__ && global.__CARDS_AT__ && t - global.__CARDS_AT__ < TTL) {
    return global.__CARDS_ALL__;
  }
  if (global.__CARDS_ERR_AT__ && t - global.__CARDS_ERR_AT__ < BACKOFF) {
    if (global.__CARDS_ALL__) return global.__CARDS_ALL__;
    throw new Error("backoff-no-cache");
  }
  if (global.__CARDS_LOADING__) return global.__CARDS_LOADING__;

  global.__CARDS_LOADING__ = (async () => {
    try {
      const data = await loadAllFromDB();
      global.__CARDS_ALL__ = data;
      global.__CARDS_AT__ = now();
      return data;
    } catch (e) {
      global.__CARDS_ERR_AT__ = now();
      throw e instanceof Error ? e : new Error("LOAD_CARDS_FAILED");
    } finally {
      global.__CARDS_LOADING__ = undefined;
    }
  })();

  return global.__CARDS_LOADING__;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const codesParam = url.searchParams.get("codes");
  const want = (codesParam || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let all: Record<string, CardRow> | null = null;

  try {
    all = await getAllCards();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[api/cards] loadAllCards failed:", e);
    if (global.__CARDS_ALL__) {
      all = global.__CARDS_ALL__;
    }
  }

  const list: CardRow[] = [];
  if (all) {
    if (want.length) {
      for (const c of want) {
        const item = all[c];
        if (item) list.push(item);
      }
    } else {
      list.push(...Object.values(all));
    }
  }

  return NextResponse.json({ ok: true, cards: list }, { status: 200 });
}
