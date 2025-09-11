// src/app/deck-builder/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import cardsDataJson from "@/data/cards.json";

/* ========= types from cards.json ========= */
type CharacterCard = { char_id: number; code: string; name: string; element: string; attack: number; hp: number; cost: number; abilityCode: string; art: string; };
type SupportCard   = { id: number;     code: string; name: string; element: string; cost: number; text: string;          art: string; };
type EventCard     = { id: number;     code: string; name: string; element: string; cost: number; text: string;          art: string; };
type CardsData = { characters: CharacterCard[]; supports: SupportCard[]; events: EventCard[] };
const cardsData = cardsDataJson as CardsData;

/* ========= API types ========= */
type InvItem = { cardId: number; code: string; kind: "character" | "support" | "event"; qty: number };
type InvRes  = { items: InvItem[] };
type DeckRes = { ok: true; deckId: number | null; name: string; characters: number[]; cards: { cardId: number; count: number }[] };

const OTHER_ID_BASE = 100; // 101..103
const FRAME_W = 256;
const FRAME_H = 384;

/* ========= Suspense wrapper ========= */
export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm opacity-70">Loading deck…</main>}>
      <DeckBuilderScreen />
    </Suspense>
  );
}

/* ========= helpers ========= */
function codeToPrettyName(code: string) {
  return code
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
}
function cardImagePath(code: string, kind: "character" | "support" | "event"): string {
  const meta =
    kind === "character"
      ? cardsData.characters.find((c) => c.code === code)
      : kind === "support"
      ? cardsData.supports.find((c) => c.code === code)
      : cardsData.events.find((c) => c.code === code);
  const file = meta?.art ?? `${code}.png`;
  return kind === "character" ? `/char_cards/${file}` : `/cards/${file}`;
}

/* ========= Real screen ========= */
function DeckBuilderScreen() {
  const sp = useSearchParams();
  const userId = Number(sp.get("userId") ?? "0") || 6; // เปลี่ยนเลข default ได้ตามต้องการ
  const [name, setName] = useState("My Deck");

  // inventory (owned)
  const [inv, setInv] = useState<InvItem[] | null>(null);
  // current selection
  const [chars, setChars] = useState<number[]>([]);
  const [others, setOthers] = useState<Record<number, number>>({ 101: 0, 102: 0, 103: 0 });

  // preload := inventory + deck
  useEffect(() => {
    (async () => {
      const [invR, deckR] = await Promise.all([
        fetch(`/api/inventory?userId=${userId}`, { cache: "no-store" }).then((r) => r.json() as Promise<InvRes>),
        fetch(`/api/deck?userId=${userId}`, { cache: "no-store" }).then((r) => r.json() as Promise<DeckRes>),
      ]);

      setInv(invR.items ?? []);

      if (deckR?.ok) {
        setName(deckR.name || "My Deck");
        setChars(deckR.characters || []);
        const m: Record<number, number> = { 101: 0, 102: 0, 103: 0 };
        for (const it of deckR.cards || []) m[it.cardId] = it.count;
        setOthers(m);
      }
    })().catch(() => {});
  }, [userId]);

  // สร้าง list จาก cards.json
  const charList = useMemo(
    () => cardsData.characters.map((c) => ({ id: c.char_id, code: c.code, art: cardImagePath(c.code, "character") })),
    [],
  );
  const [sup1] = cardsData.supports.slice(0, 1);
  const [sup2] = cardsData.supports.slice(1, 2);
  const [evt1] = cardsData.events.slice(0, 1);
  const sup1Meta = { slotId: 101 as const, code: sup1.code, art: cardImagePath(sup1.code, "support") };
  const sup2Meta = { slotId: 102 as const, code: sup2.code, art: cardImagePath(sup2.code, "support") };
  const evtMeta  = { slotId: 103 as const, code: evt1.code, art: cardImagePath(evt1.code, "event") };

  // owned helper
  const ownedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of inv ?? []) m.set(it.code, it.qty);
    return m;
  }, [inv]);

  // select/clear
  const toggleChar = (id: number, owned: number) => {
    setChars((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      // อนุญาตคลิกเฉพาะกรณีมีของ หรือ ช่องยังว่าง (<=3) และไม่ได้บังคับให้จางทั้งหน้า
      if (prev.length >= 3) return prev;
      if (owned < 1) return prev; // ไม่มีของจริง ๆ ก็ไม่ให้เพิ่มใหม่ แต่ถ้าเดิมในเด็คจะโชว์อยู่แล้ว
      return [...prev, id];
    });
  };
  const totalOthers = (m: Record<number, number>) => (m[101] ?? 0) + (m[102] ?? 0) + (m[103] ?? 0);
  const inc = (slotId: 101 | 102 | 103, owned: number) =>
    setOthers((p) => {
      const next = { ...p };
      if ((next[slotId] ?? 0) < owned && totalOthers(next) < 20) next[slotId] = (next[slotId] ?? 0) + 1;
      return next;
    });
  const dec = (slotId: 101 | 102 | 103) =>
    setOthers((p) => {
      const next = { ...p };
      if ((next[slotId] ?? 0) > 0) next[slotId] = (next[slotId] ?? 0) - 1;
      return next;
    });

  // save
  const onSave = async () => {
    const body = {
      userId,
      name,
      characters: chars,
      cards: [
        { cardId: 101, count: others[101] ?? 0 },
        { cardId: 102, count: others[102] ?? 0 },
        { cardId: 103, count: others[103] ?? 0 },
      ],
    };
    const res = await fetch("/api/deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok) {
      alert(j?.error || "Save failed");
      return;
    }
    alert("Saved!");
  };

  return (
    <main className="min-h-screen p-6 flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="px-3 py-2 rounded bg-neutral-900 border border-white/10"
          placeholder="Deck name"
        />
        <div className="ml-auto text-sm opacity-70">
          Chars {chars.length}/3 • Others {totalOthers(others)}/20 • User #{userId}
        </div>
        <button className="ml-3 px-4 py-2 rounded bg-emerald-600" onClick={onSave}>
          Save
        </button>
      </header>

      {/* Characters */}
      <section>
        <h2 className="font-semibold mb-2">Characters</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {charList.map((c) => {
            const selected = chars.includes(c.id);          // จากเด็คเดิมหรือเลือกใหม่
            const owned = ownedMap.get(c.code) ?? 0;        // จำนวนที่มี
            const cannotAdd = !selected && (owned < 1 || chars.length >= 3);

            return (
              <button
                key={c.id}
                onClick={() => !cannotAdd && toggleChar(c.id, owned)}
                className={`relative rounded-lg border bg-black/30 overflow-hidden
                  ${selected ? "border-emerald-500" : "border-white/10"}
                  ${cannotAdd ? "cursor-not-allowed" : "hover:border-white/30"}`}
                style={{ width: FRAME_W, height: FRAME_H }}
                title={codeToPrettyName(c.code)}
              >
                <Image src={c.art} alt={c.code} fill sizes="100%" className="object-contain" unoptimized />
                <div className="absolute left-2 top-2 text-[11px] bg-black/70 rounded px-1">#{c.id}</div>
                <div className="absolute right-2 top-2 text-[11px] bg-black/70 rounded px-1">owned {owned}</div>
                <div className="absolute left-2 bottom-2 text-sm">{codeToPrettyName(c.code)}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Supports & Events */}
      <section>
        <h2 className="font-semibold mb-2">Supports & Events</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[sup1Meta, sup2Meta, evtMeta].map((it) => {
            const owned = ownedMap.get(it.code) ?? 0;
            const cnt = others[it.slotId] ?? 0;
            return (
              <div key={it.slotId} className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="relative" style={{ width: FRAME_W, height: FRAME_H }}>
                  <Image src={it.art} alt={it.code} fill sizes="100%" className="object-contain" unoptimized />
                  <div className="absolute left-2 top-2 text-[11px] bg-black/70 rounded px-1">#{it.slotId - OTHER_ID_BASE}</div>
                  <div className="absolute right-2 top-2 text-[11px] bg-black/70 rounded px-1">owned {owned}</div>
                  <div className="absolute left-2 bottom-2 text-sm">{codeToPrettyName(it.code)}</div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button className="px-2 py-1 rounded bg-neutral-800" onClick={() => dec(it.slotId)}>-</button>
                  <div className="min-w-6 text-center tabular-nums">{cnt}</div>
                  <button className="px-2 py-1 rounded bg-neutral-700" onClick={() => inc(it.slotId, owned)}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
