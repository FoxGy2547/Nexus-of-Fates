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

/* ========= helpers ========= */
const OTHER_ID_BASE = 100; // 101..103
const FRAME_W = 256;
const FRAME_H = 384;

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

type InvItem = { cardId: number; code: string; kind: "character" | "support" | "event"; qty: number };
type InvRes = { items: InvItem[] };
type DeckRes = { ok: true; deckId: number | null; name: string; characters: number[]; cards: { cardId: number; count: number }[] };

/* ========= Suspense wrapper ========= */
export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm opacity-70">Loading deck…</main>}>
      <DeckBuilderScreen />
    </Suspense>
  );
}

/* ========= Real screen (ใช้ useSearchParams ได้อย่างปลอดภัย) ========= */
function DeckBuilderScreen() {
  const sp = useSearchParams();
  const userId = Number(sp.get("userId") ?? "0") || 6; // default 6 เผื่อไม่ได้ส่งมา
  const [name, setName] = useState("My Deck");

  // inventory (owned)
  const [inv, setInv] = useState<InvItem[] | null>(null);
  // current selection
  const [chars, setChars] = useState<number[]>([]);
  const [others, setOthers] = useState<Record<number, number>>({ 101: 0, 102: 0, 103: 0 });

  // preload := อ่านเด็คจาก /api/deck แล้วกดเลือกให้เลย
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
        // แปลง array เป็น map สำหรับ 101..103
        const start: Record<number, number> = { 101: 0, 102: 0, 103: 0 };
        for (const it of deckR.cards ?? []) start[it.cardId] = it.count;
        setOthers(start);
      }
    })().catch(() => {});
  }, [userId]);

  // สร้าง list card ทั้งหมดจาก cards.json เพื่อเรนเดอร์
  const charList = useMemo(
    () => cardsData.characters.map((c) => ({ id: c.char_id, code: c.code, art: cardImagePath(c.code, "character") })),
    [],
  );
  const supportList = useMemo(
    () => cardsData.supports.map((s) => ({ slotId: 101, code: s.code, art: cardImagePath(s.code, "support") })).slice(0, 1),
    [],
  );
  const support2List = useMemo(
    () => cardsData.supports.map((s) => ({ slotId: 102, code: s.code, art: cardImagePath(s.code, "support") })).slice(1, 2),
    [],
  );
  const eventList = useMemo(
    () => cardsData.events.map((e) => ({ slotId: 103, code: e.code, art: cardImagePath(e.code, "event") })).slice(0, 1),
    [],
  );

  // owned helper
  const ownedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of inv ?? []) m.set(it.code, it.qty);
    return m;
  }, [inv]);

  // select/clear
  const toggleChar = (id: number) => {
    setChars((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev; // limit 3
      return [...prev, id];
    });
  };
  const inc = (slotId: number) =>
    setOthers((p) => {
      const next = { ...p };
      const own = slotId === 101 ? (ownedMap.get(supportList[0]?.code ?? "") ?? 0) : slotId === 102 ? (ownedMap.get(support2List[0]?.code ?? "") ?? 0) : (ownedMap.get(eventList[0]?.code ?? "") ?? 0);
      if ((next[slotId] ?? 0) < own && totalOthers(next) < 20) next[slotId] = (next[slotId] ?? 0) + 1;
      return next;
    });
  const dec = (slotId: number) =>
    setOthers((p) => {
      const next = { ...p };
      if ((next[slotId] ?? 0) > 0) next[slotId] = (next[slotId] ?? 0) - 1;
      return next;
    });
  const totalOthers = (m: Record<number, number>) => (m[101] ?? 0) + (m[102] ?? 0) + (m[103] ?? 0);

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
    const res = await fetch("/api/deck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
          Chars {chars.length}/3 • Others {totalOthers(others)}/20
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
            const selected = chars.includes(c.id);
            const owned = ownedMap.get(c.code) ?? 0;
            const disabled = !selected && (chars.length >= 3 || owned < 1);
            return (
              <button
                key={c.id}
                onClick={() => !disabled && toggleChar(c.id)}
                className={`relative rounded-lg border bg-black/30 overflow-hidden ${selected ? "border-emerald-500" : "border-white/10"} ${disabled ? "opacity-40 cursor-not-allowed" : "hover:border-white/30"}`}
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
          {[supportList[0], support2List[0], eventList[0]].filter(Boolean).map((it, idx) => {
            const slotId = (101 + idx) as 101 | 102 | 103;
            const owned =
              slotId === 101 ? (ownedMap.get(supportList[0]!.code) ?? 0) :
              slotId === 102 ? (ownedMap.get(support2List[0]!.code) ?? 0) :
                                (ownedMap.get(eventList[0]!.code) ?? 0);
            const cnt = others[slotId] ?? 0;
            const title =
              slotId === 101 ? supportList[0]!.code :
              slotId === 102 ? support2List[0]!.code : eventList[0]!.code;

            return (
              <div key={slotId} className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="relative" style={{ width: FRAME_W, height: FRAME_H }}>
                  <Image
                    src={
                      slotId === 101 ? supportList[0]!.art :
                      slotId === 102 ? support2List[0]!.art  : eventList[0]!.art
                    }
                    alt={title}
                    fill
                    sizes="100%"
                    className="object-contain"
                    unoptimized
                  />
                  <div className="absolute left-2 top-2 text-[11px] bg-black/70 rounded px-1">#{slotId - OTHER_ID_BASE}</div>
                  <div className="absolute right-2 top-2 text-[11px] bg-black/70 rounded px-1">owned {owned}</div>
                  <div className="absolute left-2 bottom-2 text-sm">{codeToPrettyName(title)}</div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button className="px-2 py-1 rounded bg-neutral-800" onClick={() => dec(slotId)}>-</button>
                  <div className="min-w-6 text-center tabular-nums">{cnt}</div>
                  <button className="px-2 py-1 rounded bg-neutral-700" onClick={() => inc(slotId)}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
