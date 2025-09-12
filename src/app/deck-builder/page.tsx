// src/app/deck-builder/page.tsx
"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
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

/** -------- INVENTORY -------- */
function normalizeInventory(raw: unknown): Inventory {
  const empty: Inventory = { userId: 0, chars: {}, others: {} };
  if (!raw || typeof raw !== "object") return empty;

  const top = raw as Record<string, unknown>;

  if (Array.isArray(top.items)) {
    const inv: Inventory = { userId: Number(top.userId ?? 0) || 0, chars: {}, others: {} };
    for (const it of top.items as Array<Record<string, unknown>>) {
      const id = Number(it.cardId ?? 0);
      const qty = Number(it.qty ?? 0);
      const kind = String(it.kind ?? "");
      if (!Number.isFinite(id) || qty <= 0) continue;
      if (kind === "character") inv.chars[id] = qty;
      else inv.others[id >= 101 ? id - 100 : id] = qty;
    }
    return inv;
  }

  const row: Record<string, unknown> =
    typeof top.row === "object" && top.row ? (top.row as Record<string, unknown>) : top;

  const inv: Inventory = {
    userId: Number(row.user_id ?? 0) || Number((top.userId as number) ?? 0) || 0,
    chars: {},
    others: {},
  };

  if (typeof row.chars === "object" && row.chars && !Array.isArray(row.chars)) {
    for (const [k, v] of Object.entries(row.chars as Record<string, unknown>)) inv.chars[Number(k)] = Number(v ?? 0);
  }
  if (typeof row.others === "object" && row.others && !Array.isArray(row.others)) {
    for (const [k, v] of Object.entries(row.others as Record<string, unknown>)) inv.others[Number(k)] = Number(v ?? 0);
  }

  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "number" || typeof v === "string") {
      let m = /^char_(\d+)$/.exec(k);
      if (m) {
        inv.chars[Number(m[1])] = Number(v);
        continue;
      }
      m = /^char(\d+)$/.exec(k);
      if (m) {
        inv.chars[Number(m[1])] = Number(v);
        continue;
      }
      m = /^card_(\d+)$/.exec(k);
      if (m) {
        inv.others[Number(m[1])] = Number(v);
        continue;
      }
      m = /^card(\d+)$/.exec(k);
      if (m) {
        inv.others[Number(m[1])] = Number(v);
        continue;
      }
    }
  }

  return inv;
}

/** -------- DECK -------- */
function normalizeDeck(raw: unknown): { name: string; characters: number[]; others: Record<number, number> } {
  let deckObj: Record<string, unknown> | null = null;

  const pickRow = (x: unknown): Record<string, unknown> | null =>
    x && typeof x === "object" ? (x as Record<string, unknown>) : null;

  if (raw && typeof raw === "object") {
    const top = raw as Record<string, unknown>;
    if (top.deck && typeof top.deck === "object") deckObj = top.deck as Record<string, unknown>;
    else if (top.row && typeof top.row === "object") deckObj = top.row as Record<string, unknown>;
    else if (top.data && typeof top.data === "object") deckObj = top.data as Record<string, unknown>;
    else if (Array.isArray(top.rows) && top.rows.length) deckObj = pickRow(top.rows[0]);
    else if (Array.isArray(raw) && raw.length) deckObj = pickRow((raw as unknown[])[0]);
    else deckObj = top;
  }

  const name = String(deckObj?.name ?? "My Deck");

  let characters: number[] = [];
  if (Array.isArray(deckObj?.characters)) {
    characters = (deckObj!.characters as unknown[])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n >= 0);
  } else {
    const tmp: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const rawVal = (deckObj as Record<string, unknown> | null)?.[`card_char${i}`];
      const hasValue = rawVal !== null && rawVal !== undefined && rawVal !== "";
      const v = Number(rawVal);
      if (hasValue && Number.isFinite(v) && v >= 0) tmp.push(v);
    }
    characters = tmp;
  }

  const others: Record<number, number> = {};
  if (Array.isArray(deckObj?.cards)) {
    for (const it of deckObj!.cards as Array<Record<string, unknown>>) {
      const rawId = Number(it.cardId ?? 0);
      const uiId = rawId >= 101 ? rawId - 100 : rawId;
      const cnt = Number(it.count ?? 0);
      if (uiId > 0 && cnt > 0) others[uiId] = (others[uiId] ?? 0) + cnt;
    }
  } else {
    for (let i = 1; i <= 20; i++) {
      const v = Number(deckObj?.[`card${i}`] ?? 0);
      if (v > 0) others[v] = (others[v] ?? 0) + 1;
    }
  }

  return { name, characters, others };
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
  const router = useRouter();
  const qsUserId = Number(sp.get("userId") ?? 0) || 0;

  const [userId, setUserId] = useState<number>(qsUserId);
  const [name, setName] = useState<string>("My Deck");
  const [inv, setInv] = useState<Inventory | null>(null);
  const [selChars, setSelChars] = useState<number[]>([]);
  const [selOthers, setSelOthers] = useState<Record<number, number>>({});
  const [loaded, setLoaded] = useState<boolean>(false);

  const othersTotal = useMemo(() => Object.values(selOthers).reduce((a, b) => a + b, 0), [selOthers]);
  const canAddMore = othersTotal < 20;

  useEffect(() => {
    if (qsUserId) return;
    (async () => {
      try {
        const me = await getJSON<MeResp>("/api/me");
        const uid = Number(me.user?.id ?? 0);
        if (uid) setUserId(uid);
      } catch {}
    })();
  }, [qsUserId]);

  useEffect(() => {
    if (qsUserId && qsUserId !== userId) setUserId(qsUserId);
  }, [qsUserId, userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoaded(false);
      try {
        if (!userId) return;

        const [invRaw, deckRaw] = await Promise.all([
          getJSON<unknown>(`/api/inventory?userId=${userId}`),
          getJSON<unknown>(`/api/deck?userId=${userId}`),
        ]);

        if (!alive) return;

        const invNorm = normalizeInventory(invRaw);
        setInv(invNorm);

        const deck = normalizeDeck(deckRaw);
        setName(deck.name || "My Deck");
        setSelChars(deck.characters ?? []);
        setSelOthers(deck.others ?? {});
      } catch (e) {
        console.error("load deck/inventory failed:", e);
        setSelChars([]);
        setSelOthers({});
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  function toggleChar(id: number) {
    setSelChars((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]));
  }

  function addOther(id: number) {
    if (othersTotal >= 20) return;
    setSelOthers((prev) => {
      const totalPrev = Object.values(prev).reduce((a, b) => a + b, 0);
      if (totalPrev >= 20) return prev;
      return { ...prev, [id]: Math.min(20, (prev[id] ?? 0) + 1) };
    });
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
    if (othersTotal > 20) return alert("การ์ด Others เกิน 20 ใบ ลบออกก่อนน้า");

    const body: SaveBody = {
      userId,
      name,
      characters: selChars,
      cards: Object.entries(selOthers).map(([id, count]) => ({
        cardId: Number(id),
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

  const VISIBLE_CHAR_CARDS = useMemo(() => {
    const show = new Set<number>();
    if (inv?.chars) {
      for (const [k, qty] of Object.entries(inv.chars)) {
        if ((qty ?? 0) > 0) show.add(Number(k));
      }
    }
    for (const id of selChars) show.add(id);
    return CHAR_CARDS.filter((c) => show.has(c.id));
  }, [inv, selChars]);

  const VISIBLE_OTHER_CARDS = useMemo(() => {
    if (!inv) return [] as typeof OTHER_CARDS;
    return OTHER_CARDS.filter((o) => (inv.others?.[o.id] ?? 0) > 0);
  }, [inv]);

  if (!loaded) {
    return (
      <main className="min-h-screen p-6">
        <button
          onClick={() => router.push("/")}
          className="fixed left-4 top-4 z-50 px-3 py-1 rounded bg-red-600 hover:bg-red-500"
          title="กลับหน้าแรก"
        >
          Exit
        </button>
        <div className="opacity-70">Loading deck…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      {/* Exit button */}
      <button
        onClick={() => router.push("/")}
        className="fixed left-4 top-4 z-50 px-3 py-1 rounded bg-red-600 hover:bg-red-500"
        title="กลับหน้าแรก"
      >
        Exit
      </button>

      <header className="flex items-center gap-3">
        <input
          className="px-3 py-2 rounded bg-neutral-800 flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Deck name"
        />
        <div className="text-sm opacity-70">Chars {selChars.length}/3</div>
        <div className={`text-sm ${othersTotal > 20 ? "text-rose-400" : "opacity-70"}`}>
          Others {othersTotal}/20
        </div>
        <button className="px-4 py-2 rounded bg-emerald-600" onClick={onSave}>
          Save
        </button>
      </header>

      {/* Characters */}
      <section>
        <div className="font-semibold mb-2">Characters</div>

        {!inv && <div className="opacity-70 text-sm">Loading inventory…</div>}

        <div className="flex flex-wrap gap-3">
          {VISIBLE_CHAR_CARDS.map((c) => {
            const owned = inv?.chars?.[c.id] ?? 0;
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

      {/* Supports & Events */}
      <section>
        <div className="font-semibold mb-2">Supports & Events</div>

        {!inv && <div className="opacity-70 text-sm">Loading inventory…</div>}

        <div className="flex flex-wrap gap-3">
          {VISIBLE_OTHER_CARDS.map((o) => {
            const owned = inv?.others?.[o.id] ?? 0;
            const picked = selOthers[o.id] ?? 0;
            const selectedClass = picked > 0 ? "border-emerald-500" : "border-white/10";
            const disableAdd = !canAddMore;

            return (
              <div
                key={`${o.kind}-${o.id}`}
                className={`relative border ${selectedClass} p-3 rounded-xl bg-black/20 hover:bg-black/30`}
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
                  className={`block w-full text-left relative z-0 ${disableAdd ? "cursor-not-allowed opacity-50" : ""}`}
                  onClick={disableAdd ? undefined : () => addOther(o.id)}
                  title={disableAdd ? "เด็ค Others เต็ม 20 ใบแล้ว" : "กดการ์ดเพื่อเพิ่ม 1 ใบ"}
                  aria-disabled={disableAdd}
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
