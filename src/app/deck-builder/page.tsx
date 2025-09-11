"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import cardsDataJson from "@/data/cards.json";

/* -------------------- types -------------------- */
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
type SupportCard = { id: number; code: string; name: string; element: string; cost: number; text: string; art: string };
type EventCard = { id: number; code: string; name: string; element: string; cost: number; text: string; art: string };
type CardsData = { characters: CharacterCard[]; supports: SupportCard[]; events: EventCard[] };
const cardsData = cardsDataJson as CardsData;

type Inventory = {
  userId: number;
  /** char_1..char_12 */
  chars: Record<number, number>;
  /** card_1..card_3 (ขณะนี้มี 3 ใบ) */
  others: Record<number, number>;
};

type SaveBody = {
  userId: number;
  name: string;
  characters: number[]; // char_id ตรง ๆ
  cards: { cardId: number; count: number }[]; // id ตรง ๆ
};

/* -------------------- helpers -------------------- */
function cardImg(code: string, art: string, kind: "character" | "support" | "event"): string {
  const path = kind === "character" ? `/char_cards/${art}` : `/cards/${art}`;
  return encodeURI(path);
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
  const text = await r.text().catch(() => "");
  try {
    if (!r.ok) throw new Error(text || r.statusText);
    return (text ? JSON.parse(text) : ({} as T)) as T;
  } catch {
    if (!r.ok) throw new Error(text || r.statusText);
    return {} as T;
  }
}

/* -------------------- data from cards.json -------------------- */
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

/* -------------------- UI: badge -------------------- */
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded text-[11px] bg-black/60 text-white">{children}</span>;
}

/* -------------------- page (with suspense) -------------------- */
function PageInner() {
  const sp = useSearchParams();
  const userId = Number(sp.get("userId") ?? 0) || 0;

  // inventory
  const [inv, setInv] = useState<Inventory | null>(null);
  useEffect(() => {
    if (!userId) return;
    getJSON<Inventory>(`/api/inventory?userId=${userId}`)
      .then(setInv)
      .catch((e) => {
        console.error(e);
        alert(`โหลด inventory ไม่ได้: ${String(e)}`);
      });
  }, [userId]);

  // state: เลือกตัวละคร ≤ 3
  const [selChars, setSelChars] = useState<number[]>([]);
  // state: การ์ดอื่น ๆ (id → count)
  const [selOthers, setSelOthers] = useState<Record<number, number>>({});
  // deck name
  const [name, setName] = useState<string>("My Deck");

  // ----- characters -----
  function toggleChar(id: number) {
    setSelChars((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  // ----- supports/events -----
  function addOther(id: number) {
    setSelOthers((prev) => {
      const next = { ...prev, [id]: Math.min(20, (prev[id] ?? 0) + 1) };
      return next;
    });
  }
  function decOther(id: number) {
    setSelOthers((prev) => {
      const cur = prev[id] ?? 0;
      const n = Math.max(0, cur - 1);
      const next = { ...prev };
      if (n === 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  // ----- save -----
  async function onSave() {
    try {
      if (!userId) {
        alert("ไม่พบ userId (แนบ ?userId= ใน URL ก่อนนะ)");
        return;
      }
      if (selChars.length === 0) {
        alert("เลือกตัวละครอย่างน้อย 1 ตัวก่อนจ้า");
        return;
      }
      const cards = Object.entries(selOthers).map(([id, count]) => ({
        cardId: Number(id), // <<<<<< ใช้ id ตรง ๆ
        count: Number(count),
      }));
      const body: SaveBody = { userId, name, characters: selChars, cards };
      await postJSON("/api/deck", body);
      alert("บันทึกเด็คเรียบร้อยแล้ว!");
    } catch (e: unknown) {
      alert(`Save ล้มเหลว: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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
        <div className="text-sm opacity-70">Others {Object.values(selOthers).reduce((a, b) => a + b, 0)}/20</div>
        <button className="px-4 py-2 rounded bg-emerald-600" onClick={onSave}>
          Save
        </button>
      </header>

      {/* Characters */}
      <section>
        <div className="font-semibold mb-2">Characters</div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {CHAR_CARDS.map((c) => {
            const owned = inv?.chars?.[c.id] ?? 0;
            const selected = selChars.includes(c.id);
            return (
              <button
                key={c.id}
                className={`relative rounded-xl border p-3 text-left ${
                  selected ? "border-emerald-500" : "border-white/10"
                } bg-black/20 hover:bg-black/30`}
                onClick={() => toggleChar(c.id)}
              >
                <div className="absolute left-2 top-2">
                  <Badge>#{c.id}</Badge>
                </div>
                <div className="absolute right-2 top-2">
                  <Badge>owned {owned}</Badge>
                </div>
                <div className="h-28 relative mt-6">
                  <Image
                    fill
                    alt={c.code}
                    src={cardImg(c.code, c.art, "character")}
                    className="object-cover rounded-lg"
                    unoptimized
                  />
                </div>
                <div className="mt-2 font-medium">{c.name || c.code.replaceAll("_", " ")}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Supports & Events */}
      <section>
        <div className="font-semibold mb-2">Supports & Events</div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {OTHER_CARDS.map((o) => {
            const owned = inv?.others?.[o.id] ?? 0;
            const picked = selOthers[o.id] ?? 0;
            return (
              <div
                key={`${o.kind}-${o.id}`}
                className="relative rounded-xl border border-white/10 p-3 bg-black/20 hover:bg-black/30"
              >
                <div className="absolute left-2 top-2">
                  <Badge>#{o.id}</Badge>
                </div>
                <div className="absolute left-12 top-2">
                  <Badge>owned {owned}</Badge>
                </div>
                {/* ปุ่มลบมุมขวาบน */}
                {picked > 0 && (
                  <button
                    className="absolute right-2 top-2 rounded bg-rose-600 px-1.5 py-0.5 text-[11px]"
                    onClick={() => decOther(o.id)}
                    title="ลบ 1 ใบ"
                  >
                    −
                  </button>
                )}

                <button
                  className="block w-full text-left"
                  onClick={() => addOther(o.id)}
                  title="กดการ์ดเพื่อเพิ่ม 1 ใบ"
                >
                  <div className="h-28 relative">
                    <Image
                      fill
                      alt={o.code}
                      src={cardImg(o.code, o.art, o.kind)}
                      className="object-cover rounded-lg"
                      unoptimized
                    />
                  </div>
                  <div className="mt-2 font-medium">{o.name || o.code.replaceAll("_", " ")}</div>
                </button>

                <div className="absolute right-2 bottom-2">
                  <Badge>{picked}</Badge>
                </div>
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
