import { NextResponse } from "next/server";
import rawCardsData from "@/data/cards.json";

/** Next.js route config */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  type: "character" | "support" | "event" | null;
  rarity?: string | null;
  role?: string | null;
  image: string;
  /** เพิ่มฟิลด์ id/char_id สำหรับอ้างอิงใน DB */
  id?: number | null;       // ใช้กับ supports/events
  char_id?: number | null;  // ใช้กับ characters
};

/* ==== JSON schema ==== */
type CharacterJSON = {
  char_id: number;
  code: string;
  name?: string;
  element?: Element;
  attack?: number;
  hp?: number;
  cost?: number;
  abilityCode?: string | null;
};

type SupportJSON = {
  id: number;
  code: string;
  name?: string;
  element?: Element;
  cost?: number;
  text?: string;
  abilityCode?: string | null;
};

type EventJSON = {
  id: number;
  code: string;
  name?: string;
  element?: Element;
  cost?: number;
  text?: string;
  abilityCode?: string | null;
};

type CardsJSON = {
  characters?: CharacterJSON[];
  supports?: SupportJSON[];
  events?: EventJSON[];
};

let cacheByCode: Record<string, CardRow> = {};
let cacheLoadedAt = 0;
const TTL_MS = 60_000;

const cardsData: CardsJSON = (rawCardsData as unknown as CardsJSON);

function now(): number { return Date.now(); }
function img(name: string) { return `/cards/${name}.png`; }
function safeArr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }

function loadAllFromJSON(): Record<string, CardRow> {
  const map: Record<string, CardRow> = {};

  for (const c of safeArr<CharacterJSON>(cardsData.characters)) {
    const name = (c.name ?? c.code).trim();
    map[c.code] = {
      code: c.code,
      name,
      element: (c.element ?? "Neutral") as Element,
      attack: Number(c.attack ?? 0),
      hp: Number(c.hp ?? 0),
      ability: String(c.abilityCode ?? ""),
      cost: Number(c.cost ?? 0),
      type: "character",
      rarity: null,
      role: null,
      image: img(name),
      id: null,
      char_id: Number(c.char_id),
    };
  }

  for (const s of safeArr<SupportJSON>(cardsData.supports)) {
    const name = (s.name ?? s.code).trim();
    map[s.code] = {
      code: s.code,
      name,
      element: (s.element ?? "Neutral") as Element,
      attack: 0,
      hp: 0,
      ability: String(s.abilityCode ?? s.text ?? ""),
      cost: Number(s.cost ?? 0),
      type: "support",
      rarity: null,
      role: null,
      image: img(name),
      id: Number(s.id),
      char_id: null,
    };
  }

  for (const e of safeArr<EventJSON>(cardsData.events)) {
    const name = (e.name ?? e.code).trim();
    map[e.code] = {
      code: e.code,
      name,
      element: (e.element ?? "Neutral") as Element,
      attack: 0,
      hp: 0,
      ability: String(e.abilityCode ?? e.text ?? ""),
      cost: Number(e.cost ?? 0),
      type: "event",
      rarity: null,
      role: null,
      image: img(name),
      id: Number(e.id),
      char_id: null,
    };
  }

  return map;
}

async function ensureCache(): Promise<void> {
  const fresh = now() - cacheLoadedAt < TTL_MS && Object.keys(cacheByCode).length > 0;
  if (fresh) return;
  cacheByCode = loadAllFromJSON();
  cacheLoadedAt = now();
}

function pickByCodes(codesCSV: string | null): CardRow[] {
  if (!codesCSV) return Object.values(cacheByCode);
  const wanted = Array.from(
    new Set(
      codesCSV.split(",").map((s) => s.trim()).filter(Boolean)
    )
  );
  const out: CardRow[] = [];
  for (const c of wanted) {
    const row = cacheByCode[c];
    if (row) out.push(row);
  }
  return out;
}

export async function GET(req: Request) {
  try {
    await ensureCache();
    const url = new URL(req.url);
    const codesCSV = url.searchParams.get("codes");
    const cards = pickByCodes(codesCSV);
    return NextResponse.json({ ok: true, count: cards.length, cards }, { status: 200 });
  } catch (err) {
    console.warn("[api/cards] GET error:", err);
    return NextResponse.json({ ok: false, cards: [] as CardRow[] }, { status: 200 });
  }
}
