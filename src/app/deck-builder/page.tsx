// src/app/deck-builder/page.tsx
"use client";

import React, { Suspense, useEffect, useState } from "react";
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
type EventCard   = { id: number; code: string; name: string; element: string; cost: number; text: string; art: string };
type CardsData   = { characters: CharacterCard[]; supports: SupportCard[]; events: EventCard[] };
const cardsData  = cardsDataJson as CardsData;

type Inventory = {
  userId: number;
  chars:  Record<number, number>; // char_1..12
  others: Record<number, number>; // card_1..3
};

type SaveBody = {
  userId: number;
  name: string;
  characters: number[];                    // char_id ตรง ๆ
  cards: { cardId: number; count: number }[]; // id ตรง ๆ
};

/* -------------------- const -------------------- */
const CARD_W = 220; // ~ ครึ่งจากของเดิม
const CARD_RATIO = "aspect-[2/3]"; // 1024x1536

/* -------------------- helpers -------------------- */
function cardImg(art: string, kind: "character" | "support" | "event"): string {
  const path = kind === "character" ? `/cards/char_cards/${art}` : `/cards/${art}`;
  return encodeURI(path);
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
  return (await r.json()) as T;
}
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify(body) });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(text || r.statusText);
  return (text ? JSON.parse(text) : ({} as T)) as T;
}

/* -------------------- data from cards.json -------------------- */
const CHAR_CARDS = cardsData.characters.map(c => ({ id: c.char_id, code: c.code, name: c.name, art: c.art }));
const OTHER_CARDS = [
  ...cardsData.supports.map(s => ({ id: s.id, code: s.code, name: s.name, art: s.art, kind: "support" as const })),
  ...cardsData.events.map(e => ({ id: e.id, code: e.code, name: e.name, art: e.art, kind: "event"  as const })),
];

/* -------------------- UI bits -------------------- */
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

/* -------------------- page -------------------- */
function PageInner() {
  const sp = useSearchParams();
  const userId = Number(sp.get("userId") ?? 0) || 0;

  const [inv, setInv] = useState<Inventory | null>(null);
  const [name, setName] = useState<string>("My Deck");
  const [selChars, setSelChars]   = useState<number[]>([]);
  const [selOthers, setSelOthers] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!userId) return;
    getJSON<Inventory>(`/api/inventory?userId=${userId}`)
      .then(setInv)
      .catch(e => { console.error(e); alert(`โหลด inventory ไม่ได้: ${String(e)}`); });
  }, [userId]);

  function toggleChar(id: number) {
    setSelChars(prev => prev.includes(id) ? prev.filter(x => x !== id) : (prev.length >= 3 ? prev : [...prev, id]));
  }
  function addOther(id: number) {
    setSelOthers(prev => ({ ...prev, [id]: Math.min(20, (prev[id] ?? 0) + 1) }));
  }
  function decOther(id: number) {
    setSelOthers(prev => {
      const n = Math.max(0, (prev[id] ?? 0) - 1);
      const next = { ...prev };
      if (n === 0) delete next[id]; else next[id] = n;
      return next;
    });
  }

  async function onSave() {
    try {
      if (!userId) { alert("ไม่พบ userId (แนบ ?userId= ใน URL)"); return; }
      if (selChars.length === 0) { alert("เลือกตัวละครอย่างน้อย 1 ตัวก่อนจ้า"); return; }
      const cards = Object.entries(selOthers).map(([id, count]) => ({ cardId: Number(id), count: Number(count) }));
      const body: SaveBody = { userId, name, characters: selChars, cards };
      await postJSON("/api/deck", body);
      alert("บันทึกเด็คเรียบร้อยแล้ว!");
    } catch (e) { alert(`Save ล้มเหลว: ${e instanceof Error ? e.message : String(e)}`); }
  }

  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <input className="px-3 py-2 rounded bg-neutral-800 flex-1" value={name} onChange={(e)=>setName(e.target.value)} placeholder="Deck name" />
        <div className="text-sm opacity-70">Chars {selChars.length}/3</div>
        <div className="text-sm opacity-70">Others {Object.values(selOthers).reduce((a,b)=>a+b,0)}/20</div>
        <button className="px-4 py-2 rounded bg-emerald-600" onClick={onSave}>Save</button>
      </header>

      {/* Characters */}
      <section>
        <div className="font-semibold mb-2">Characters</div>
        <div className="flex flex-wrap gap-3">
          {CHAR_CARDS.map(c => {
            const owned = inv?.chars?.[c.id] ?? 0;
            const selected = selChars.includes(c.id);
            const src = cardImg(c.art, "character");
            return (
              <button
                key={c.id}
                className={`relative border p-3 text-left rounded-xl ${selected ? "border-emerald-500" : "border-white/10"} bg-black/20 hover:bg-black/30`}
                style={{ width: CARD_W }}
                onClick={() => toggleChar(c.id)}
                title="กดเพื่อเลือก/เอาออก"
              >
                <div className="absolute left-2 top-2 z-10"><Badge>#{c.id}</Badge></div>
                <div className="absolute right-2 top-2 z-10"><Badge>owned {owned}</Badge></div>

                <div className="mt-3">
                  <PortraitCardImage src={src} alt={c.code} />
                </div>

                <div className="mt-2 font-medium truncate">{c.name || c.code.replaceAll("_"," ")}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Supports & Events */}
      <section>
        <div className="font-semibold mb-2">Supports & Events</div>
        <div className="flex flex-wrap gap-3">
          {OTHER_CARDS.map(o => {
            const owned  = inv?.others?.[o.id] ?? 0;
            const picked = selOthers[o.id] ?? 0;
            const src    = cardImg(o.art, o.kind);
            return (
              <div
                key={`${o.kind}-${o.id}`}
                className="relative border border-white/10 p-3 rounded-xl bg-black/20 hover:bg-black/30"
                style={{ width: CARD_W }}
              >
                {/* overlays ต้องอยู่เหนือภาพเสมอ */}
                <div className="absolute left-2 top-2 z-20"><Badge>#{o.id}</Badge></div>
                <div className="absolute left-12 top-2 z-20"><Badge>owned {owned}</Badge></div>

                {picked > 0 && (
                  <button
                    className="absolute right-2 top-2 z-30 rounded bg-rose-600 px-1.5 py-0.5 text-[11px]"
                    onClick={() => decOther(o.id)}
                    title="ลบ 1 ใบ"
                  >
                    −
                  </button>
                )}

                {/* กดภาพ = เพิ่ม 1 ใบ */}
                <button className="block w-full text-left relative z-0" onClick={() => addOther(o.id)} title="กดการ์ดเพื่อเพิ่ม 1 ใบ">
                  <PortraitCardImage src={src} alt={o.code} />
                  <div className="mt-2 font-medium truncate">{o.name || o.code.replaceAll("_"," ")}</div>
                </button>

                <div className="absolute right-2 bottom-2 z-20"><Badge>{picked}</Badge></div>
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
