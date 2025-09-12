// src/app/deck-builder/page.tsx
"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import cardsDataJson from "@/data/cards.json";

/* ================= types ================= */
type CharacterCard = {
  char_id: number;
  code: string;
  name: string;
  element: string;
  attack: number;
  hp: number;
  cost: number;
  abilityCode: string;
  art: string;
};
type SupportCard = {
  id: number;
  code: string;
  name: string;
  element: string;
  cost: number;
  text: string;
  art: string;
};
type EventCard = {
  id: number;
  code: string;
  name: string;
  element: string;
  cost: number;
  text: string;
  art: string;
};
type CardsData = {
  characters: CharacterCard[];
  supports: SupportCard[];
  events: EventCard[];
};
const cardsData = cardsDataJson as CardsData;

type Inventory = { userId: number; chars: Record<number, number>; others: Record<number, number> };

type SaveBody = {
  userId: number;
  name: string;
  characters: number[];
  cards: { cardId: number; count: number }[];
};

type DeckResp =
  | { ok: true; deck: { name: string; characters: number[]; cards: { cardId: number; count: number }[] } }
  | { ok: true; deck?: undefined };

type MeResp = { ok: boolean; user?: { id: number } };

/* ================ constants ================ */
const CARD_W = 220;
const CARD_RATIO = "aspect-[2/3]";

/* ================ helpers ================ */
function cardImg(art: string, kind: "character" | "support" | "event"): string {
  return encodeURI(kind === "character" ? `/char_cards/${art}` : `/cards/${art}`);
}
async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
  return (await r.json()) as T;
}
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const txt = await r.text().catch(() => "");
  if (!r.ok) throw new Error(txt || r.statusText);
  return (txt ? JSON.parse(txt) : ({} as T)) as T;
}

/** แปลงไอดีการ์ดอื่นๆ (support/event) ระหว่าง UI ↔ DB */
const toUiOtherId = (dbId: number) => (dbId >= 101 ? dbId - 100 : dbId);
const toDbOtherId = (uiId: number) => (uiId >= 101 ? uiId : uiId + 100);

/** แปลง payload inventory เป็น {chars, others}
 *  รองรับ 2 รูปแบบ:
 *   A) row: { user_id, char_1..char_12, card_1..card_3 }
 *   B) items: [{ cardId, kind: "character"|"support"|"event", qty }]
 *      - สำหรับ support/event จะเป็น cardId = 101..103 → map กลับเป็น 1..3
 */
function normalizeInventory(raw: unknown): Inventory {
  const empty: Inventory = { userId: 0, chars: {}, others: {} };
  if (!raw || typeof raw !== "object") return empty;

  const top = raw as Record<string, unknown>;

  // รูปแบบ B: items
  if (Array.isArray(top.items)) {
    const inv: Inventory = { userId: Number(top.userId ?? 0) || 0, chars: {}, others: {} };
    for (const it of top.items as Array<Record<string, unknown>>) {
      const id = Number(it.cardId ?? 0);
      const qty = Number(it.qty ?? 0);
      const kind = String(it.kind ?? "");
      if (!Number.isFinite(id) || qty <= 0) continue;
      if (kind === "character") {
        inv.chars[id] = qty;
      } else {
        // 101/102/103 -> 1/2/3
        const slot = id >= 101 ? id - 100 : id;
        inv.others[slot] = qty;
      }
    }
    return inv;
  }

  // รูปแบบ A: row เดี่ยว
  const row: Record<string, unknown> =
    typeof top.row === "object" && top.row ? (top.row as Record<string, unknown>) : top;

  const inv: Inventory = {
    userId: Number(row.user_id ?? 0) || Number((top.userId as number) ?? 0) || 0,
    chars: {},
    others: {},
  };

  // ถ้ามีทรงมาตรฐานอยู่แล้ว
  if (typeof row.chars === "object" && row.chars && !Array.isArray(row.chars)) {
    const c = row.chars as Record<string, unknown>;
    for (const [k, v] of Object.entries(c)) inv.chars[Number(k)] = Number(v ?? 0);
  }
  if (typeof row.others === "object" && row.others && !Array.isArray(row.others)) {
    const o = row.others as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) inv.others[Number(k)] = Number(v ?? 0);
  }

  // map char_*/card_* → inv
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "number" || typeof v === "string") {
      const mChar = /^char_(\d+)$/.exec(k);
      if (mChar) {
        inv.chars[Number(mChar[1])] = Number(v);
        continue;
      }
      const mCard = /^card_(\d+)$/.exec(k);
      if (mCard) {
        inv.others[Number(mCard[1])] = Number(v);
        continue;
      }
    }
  }
  return inv;
}

/* ================ data from cards.json ================ */
const CHAR_CARDS = cardsData.characters.map((c) => ({
  id: c.char_id,
  code: c.code,
  name: c.name,
  art: c.art,
}));
const OTHER_CARDS = [
  ...cardsData.supports.map((s) => ({ id: s.id, code: s.code, name: s.name, art: s.art, kind: "support" as const })),
  ...cardsData.events.map((e) => ({ id: e.id, code: e.code, name: e.name, art: e.art, kind: "event" as const })),
];

/* ================ UI bits ================ */
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded text-[11px] bg-black/70 text-white pointer-events-none">{children}</span>;
}
function PortraitCardImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className={`relative w-full ${CARD_RATIO} rounded-lg overflow-hidden bg-neutral-900/60`}>
      <Image src={src} alt={alt} fill className="object-contain" unoptimized />
    </div>
  );
}

/* ================= Page ================= */
function PageInner() {
  const sp = useSearchParams();
  const qsUserId = Number(sp.get("userId") ?? 0) || 0;

  const [userId, setUserId] = useState<number>(qsUserId);
  const [name, setName] = useState<string>("My Deck");
  const [inv, setInv] = useState<Inventory | null>(null);
  const [selChars, setSelChars] = useState<number[]>([]);
  const [selOthers, setSelOthers] = useState<Record<number, number>>({});
  const othersTotal = useMemo(() => Object.values(selOthers).reduce((a, b) => a + b, 0), [selOthers]);

  // ถ้าไม่มี ?userId= ลอง /api/me
  useEffect(() => {
    if (qsUserId) return;
    (async () => {
      try {
        const me = await getJSON<MeResp>("/api/me");
        const uid = Number(me.user?.id ?? 0);
        if (uid) setUserId(uid);
      } catch {
        /* ignore */
      }
    })();
  }, [qsUserId]);

  // sync ?userId=
  useEffect(() => {
    if (qsUserId && qsUserId !== userId) setUserId(qsUserId);
  }, [qsUserId, userId]);

  // โหลด inventory + deck → พรีฟิล
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const [invRaw, deckResp] = await Promise.all([
          getJSON<unknown>(`/api/inventory?userId=${userId}`),
          getJSON<DeckResp>(`/api/deck?userId=${userId}`),
        ]);
        const norm = normalizeInventory(invRaw);
        setInv(norm);

        if (deckResp.deck) {
          setName(deckResp.deck.name || "My Deck");
          setSelChars(deckResp.deck.characters ?? []);
          // 🔁 แปลง cardId จาก DB (101..103) → UI (1..3) แล้วเติมจำนวน
          const rec: Record<number, number> = {};
          for (const it of deckResp.deck.cards ?? []) {
            const uiId = toUiOtherId(it.cardId);
            rec[uiId] = (rec[uiId] ?? 0) + it.count;
          }
          setSelOthers(rec);
        } else {
          setSelChars([]);
          setSelOthers({});
        }
      } catch (e) {
        console.error("load deck/inventory failed:", e);
      }
    })();
  }, [userId]);

  // ตัวช่วยเลือก/แก้จำนวน
  function toggleChar(id: number) {
    setSelChars((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]));
  }
  function addOther(id: number) {
    setSelOthers((prev) => ({ ...prev, [id]: Math.min(20, (prev[id] ?? 0) + 1) }));
  }
  function decOther(id: number) {
    setSelOthers((prev) => {
      const n = Math.max(0, (prev[id] ?? 0) - 1);
      const next = { ...prev };
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  async function onSave() {
    if (!userId) return alert("ไม่พบ userId");
    if (selChars.length === 0) return alert("เลือกตัวละครอย่างน้อย 1 ตัว");
    const body: SaveBody = {
      userId,
      name,
      characters: selChars,
      // 🔁 แปลงกลับ UI (1..3) → DB (101..103)
      cards: Object.entries(selOthers).map(([id, count]) => ({
        cardId: toDbOtherId(Number(id)),
        count: Number(count),
      })),
    };
    try {
      await postJSON("/api/deck", body);
      alert("บันทึกเด็คเรียบร้อยแล้ว!");
    } catch (e) {
      alert(`Save ล้มเหลว: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ========== FILTER: แสดงเฉพาะใบที่ "มี" ==========
  const VISIBLE_CHAR_CARDS = useMemo(() => {
    if (!inv) return [] as typeof CHAR_CARDS;
    return CHAR_CARDS.filter((c) => (inv.chars?.[c.id] ?? 0) > 0);
  }, [inv]);

  const VISIBLE_OTHER_CARDS = useMemo(() => {
    if (!inv) return [] as typeof OTHER_CARDS;
    return OTHER_CARDS.filter((o) => (inv.others?.[o.id] ?? 0) > 0);
  }, [inv]);

  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <input
          className="px-3 py-2 rounded bg-neutral-800 flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Deck name"
        />
        <div className="text-sm opacity-70">Chars {selChars.length}/3</div>
        <div className="text-sm opacity-70">Others {othersTotal}/20</div>
        <button className="px-4 py-2 rounded bg-emerald-600" onClick={onSave}>
          Save
        </button>
      </header>

      {/* Characters (เฉพาะที่มี) */}
      <section>
        <div className="font-semibold mb-2">Characters</div>

        {!inv && <div className="opacity-70 text-sm">Loading inventory…</div>}

        <div className="flex flex-wrap gap-3">
          {VISIBLE_CHAR_CARDS.map((c) => {
            const owned = inv?.chars?.[c.id] ?? 0; // >0 เสมอ เพราะผ่าน filter
            const selected = selChars.includes(c.id);
            return (
              <button
                key={c.id}
                className={`relative border p-3 text-left rounded-xl ${
                  selected ? "border-emerald-500" : "border-white/10"
                } bg-black/20 hover:bg-black/30`}
                style={{ width: CARD_W }}
                onClick={() => toggleChar(c.id)}
                title="กดเพื่อเลือก/เอาออก"
              >
                <div className="absolute left-2 top-2 z-10">
                  <Badge>#{c.id}</Badge>
                </div>
                <div className="absolute right-2 top-2 z-10">
                  <Badge>owned {owned}</Badge>
                </div>
                <div className="mt-3">
                  <PortraitCardImage src={cardImg(c.art, "character")} alt={c.code} />
                </div>
                <div className="mt-2 font-medium truncate">{c.name || c.code.replaceAll("_", " ")}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Supports & Events (เฉพาะที่มี) */}
      <section>
        <div className="font-semibold mb-2">Supports & Events</div>

        {!inv && <div className="opacity-70 text-sm">Loading inventory…</div>}

        <div className="flex flex-wrap gap-3">
          {VISIBLE_OTHER_CARDS.map((o) => {
            const owned = inv?.others?.[o.id] ?? 0; // >0 เสมอ
            const picked = selOthers[o.id] ?? 0;
            return (
              <div
                key={`${o.kind}-${o.id}`}
                className="relative border border-white/10 p-3 rounded-xl bg-black/20 hover:bg-black/30"
                style={{ width: CARD_W }}
              >
                <div className="absolute left-2 top-2 z-20">
                  <Badge>#{o.id}</Badge>
                </div>
                <div className="absolute left-12 top-2 z-20">
                  <Badge>owned {owned}</Badge>
                </div>

                {picked > 0 && (
                  <button
                    className="absolute right-2 top-2 z-30 rounded bg-rose-600 px-1.5 py-0.5 text-[11px]"
                    onClick={() => decOther(o.id)}
                    title="ลบ 1 ใบ"
                  >
                    −
                  </button>
                )}

                <button
                  className="block w-full text-left relative z-0"
                  onClick={() => addOther(o.id)}
                  title="กดการ์ดเพื่อเพิ่ม 1 ใบ"
                >
                  <PortraitCardImage src={cardImg(o.art, o.kind)} alt={o.code} />
                  <div className="mt-2 font-medium truncate">{o.name || o.code.replaceAll("_", " ")}</div>
                </button>

                {picked > 0 && (
                  <div className="absolute right-2 bottom-2 z-20">
                    <Badge>{picked}</Badge>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export default function DeckBuilderPage() {
  return (
    <Suspense fallback={<main className="min-h-screen p-6">Loading…</main>}>
      <PageInner />
    </Suspense>
  );
}
