// src/app/deck-builder/page.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import cardsDataJson from "@/data/cards.json";

/* ===== types from cards.json ===== */
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

/* ===== helpers (art path จาก cards.json) ===== */
function cardImagePath(code: string, art: string, kind: "character" | "support" | "event"): string {
  return kind === "character" ? `/char_cards/${art}` : `/cards/${art}`;
}

const ELEMENT_ICON: Record<string, string> = {
  Pyro: "/dice/pyro.png",
  Hydro: "/dice/hydro.png",
  Cryo: "/dice/cryo.png",
  Electro: "/dice/electro.png",
  Geo: "/dice/geo.png",
  Anemo: "/dice/anemo.png",
  Quantum: "/dice/quantum.png",
  Imaginary: "/dice/imaginary.png",
  Neutral: "/dice/neutral.png",
  Infinite: "/dice/infinite.png",
};

/* ===== page ===== */
export default function DeckBuilderPage() {
  const sp = useSearchParams();
  const userId = Number(sp.get("userId") || ""); // ต้องมี userId เพื่อดึง inventory/deck

  // — master lists
  const CHAR_LIST = cardsData.characters;
  const OTHER_LIST = [...cardsData.supports, ...cardsData.events].map((c) => ({
    ...c,
    kind: "supportOrEvent" as const,
  }));

  // — owned from /api/inventory
  const [ownedChar, setOwnedChar] = useState<Record<number, number>>({});
  const [ownedCard, setOwnedCard] = useState<Record<number, number>>({});

  // — deck selection states
  const [deckId, setDeckId] = useState<number | null>(null);
  const [name, setName] = useState<string>("My Deck");
  const [selChars, setSelChars] = useState<number[]>([]); // char ids (≤3)
  const [otherCount, setOtherCount] = useState<Record<number, number>>({}); // card id -> count

  const totalOthers = useMemo(
    () => Object.values(otherCount).reduce((a, b) => a + (b ?? 0), 0),
    [otherCount]
  );

  /* ---------- load inventory & deck on mount ---------- */
  useEffect(() => {
    if (!userId) return;

    // 1) owned
    (async () => {
      const r = await fetch(`/api/inventory?userId=${userId}`, { cache: "no-store" });
      const j = (await r.json()) as {
        ok?: boolean;
        char?: Record<number, number>;
        card?: Record<number, number>;
      };
      if (j?.char) setOwnedChar(j.char);
      if (j?.card) setOwnedCard(j.card);
    })();

    // 2) last deck
    (async () => {
      const r = await fetch(`/api/deck?userId=${userId}`, { cache: "no-store" });
      const j = (await r.json()) as {
        ok: boolean;
        deck: { deckId: number; name: string; chars: number[]; cards: number[] } | null;
      };
      if (j?.deck) {
        setDeckId(j.deck.deckId);
        setName(j.deck.name || "My Deck");
        setSelChars(j.deck.chars.slice(0, 3));

        // แปลง array เป็น map นับจำนวน
        const m: Record<number, number> = {};
        for (const id of j.deck.cards) m[id] = (m[id] ?? 0) + 1;
        setOtherCount(m);
      } else {
        // ไม่มีเด็ค -> เคลียร์
        setDeckId(null);
        setSelChars([]);
        setOtherCount({});
      }
    })();
  }, [userId]);

  /* ---------- select handlers ---------- */
  function toggleChar(id: number) {
    setSelChars((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev; // จำกัด 3
      return [...prev, id];
    });
  }
  function incOther(id: number) {
    setOtherCount((p) => {
      const now = p[id] ?? 0;
      if (totalOthers >= 20 && now === 0) return p; // เกินโควต้า
      return { ...p, [id]: Math.min(now + 1, 20) };
    });
  }
  function decOther(id: number) {
    setOtherCount((p) => {
      const now = p[id] ?? 0;
      if (now <= 0) return p;
      const nx = { ...p, [id]: now - 1 };
      if (nx[id] <= 0) delete nx[id];
      return nx;
    });
  }

  /* ---------- save ---------- */
  async function onSave() {
    if (!userId) {
      alert("ต้องมี userId ใน query เช่น /deck-builder?userId=6");
      return;
    }
    const flatOthers: { cardId: number; count: number }[] = Object.entries(otherCount).map(([k, v]) => ({
      cardId: Number(k),
      count: Number(v ?? 0),
    }));
    const res = await fetch("/api/deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deckId: deckId ?? undefined,
        userId,
        name,
        characters: selChars,
        cards: flatOthers,
      }),
    });
    const j = (await res.json()) as { ok?: boolean; deckId?: number; error?: string };
    if (!res.ok || !j.ok) {
      alert(j.error || "save failed");
      return;
    }
    setDeckId(j.deckId ?? deckId);
    alert("Saved!");
  }

  /* ---------- ui bits ---------- */
  function OwnedBadge({ n }: { n: number }) {
    return (
      <span className="absolute left-1 top-1 text-[10px] rounded bg-black/70 px-1">
        owned {n}
      </span>
    );
  }

  function CardShell({
    children,
    selected,
    onRemove,
  }: {
    children: React.ReactNode;
    selected?: boolean;
    onRemove?: () => void;
  }) {
    return (
      <div
        className={`relative rounded-xl border bg-black/40 ${
          selected ? "border-emerald-400" : "border-white/10"
        }`}
      >
        {selected && onRemove && (
          <button
            onClick={onRemove}
            className="absolute right-1 top-1 rounded bg-rose-600 text-xs px-1"
            title="remove"
          >
            ×
          </button>
        )}
        {children}
      </div>
    );
  }

  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="px-3 py-2 rounded bg-neutral-900 border border-white/10"
          placeholder="Deck name"
        />
        <div className="ml-auto text-sm opacity-70">
          Chars {selChars.length}/3 · Others {totalOthers}/20
        </div>
        <button className="px-4 py-2 rounded bg-emerald-600" onClick={onSave}>
          Save
        </button>
      </header>

      {/* characters */}
      <section>
        <h2 className="font-semibold mb-2">Characters</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {CHAR_LIST.map((c) => {
            const owned = ownedChar[c.char_id] ?? 0;
            const selected = selChars.includes(c.char_id);
            const art = cardImagePath(c.code, c.art, "character");
            return (
              <CardShell
                key={c.char_id}
                selected={selected}
                onRemove={selected ? () => toggleChar(c.char_id) : undefined}
              >
                <button
                  onClick={() => toggleChar(c.char_id)}
                  className="block w-full"
                  title={c.name}
                >
                  <div className="relative aspect-[2/3]">
                    <Image src={art} alt={c.name} fill className="object-contain" unoptimized />
                    <OwnedBadge n={owned} />
                  </div>
                  <div className="px-2 py-2 text-sm">{c.name}</div>
                </button>
              </CardShell>
            );
          })}
        </div>
      </section>

      {/* supports & events */}
      <section>
        <h2 className="font-semibold mb-2">Supports & Events</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {OTHER_LIST.map((c) => {
            const id = (c as SupportCard | EventCard).id;
            const owned = ownedCard[id] ?? 0;
            const picked = otherCount[id] ?? 0;
            const art = cardImagePath(c.code, c.art, "support");
            return (
              <CardShell key={`o-${id}`}>
                <div className="relative aspect-[2/3]">
                  <Image src={art} alt={c.name} fill className="object-contain" unoptimized />
                  <OwnedBadge n={owned} />
                  {/* ปุ่ม + / – มุมขวา */}
                  <div className="absolute right-1 top-1 flex gap-1">
                    <button
                      onClick={() => decOther(id)}
                      className="rounded bg-neutral-700 px-2 text-xs"
                      title="remove 1"
                    >
                      –
                    </button>
                    <button
                      onClick={() => incOther(id)}
                      className="rounded bg-emerald-700 px-2 text-xs"
                      title="add 1"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="px-2 py-2 text-sm flex items-center justify-between">
                  <span className="truncate">{c.name}</span>
                  <span className="text-xs opacity-70">{picked}</span>
                </div>
              </CardShell>
            );
          })}
        </div>
      </section>
    </main>
  );
}
