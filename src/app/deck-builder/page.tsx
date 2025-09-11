// src/app/deck-builder/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  cardId: number;
  code: string;
  kind: "character" | "support" | "event";
  qty: number;
};

export default function DeckBuilderPage() {
  const [meId, setMeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("My Deck");

  // selections
  const [chars, setChars] = useState<number[]>([]);
  const [others, setOthers] = useState<Record<number, number>>({}); // cardId -> count
  const totalOthers = useMemo(() => Object.values(others).reduce((a, b) => a + b, 0), [others]);

  // โหลด me → inventory
  useEffect(() => {
    (async () => {
      try {
        const me = await fetch("/api/me", { cache: "no-store" }).then(r => r.json());
        if (!me?.userId) throw new Error("me not found");
        setMeId(Number(me.userId));

        const inv = await fetch(`/api/inventory?userId=${me.userId}`, { cache: "no-store" }).then(r => r.json());
        setItems((inv?.items ?? []) as Item[]);
      } catch (e) {
        alert((e as Error).message || "load failed");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const characters = useMemo(() => items.filter(i => i.kind === "character"), [items]);
  const othersPool = useMemo(() => items.filter(i => i.kind !== "character"), [items]);

  function toggleChar(cardId: number) {
    if (chars.includes(cardId)) setChars(chars.filter(x => x !== cardId));
    else if (chars.length < 3) setChars([...chars, cardId]);
  }
  function incOther(cardId: number) {
    const max = items.find(i => i.cardId === cardId)?.qty ?? 0;
    const cur = others[cardId] ?? 0;
    if (totalOthers >= 20 || cur >= max) return;
    setOthers({ ...others, [cardId]: cur + 1 });
  }
  function decOther(cardId: number) {
    const cur = others[cardId] ?? 0;
    if (cur <= 0) return;
    const next = { ...others, [cardId]: cur - 1 };
    if (next[cardId] === 0) delete next[cardId];
    setOthers(next);
  }

  async function save() {
    if (!meId) return alert("no user");
    const payload = {
      userId: meId,
      name,
      characters: chars,
      cards: Object.entries(others).map(([k, v]) => ({ cardId: Number(k), count: v })),
    };
    const res = await fetch("/api/deck", { method: "POST", body: JSON.stringify(payload) });
    const json = await res.json();
    if (json?.ok) alert(`Saved deck #${json.deckId}`);
    else alert(`Error: ${json?.error ?? "save failed"}`);
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 backdrop-blur bg-neutral-950/60 border-b border-neutral-900">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            aria-label="Deck name"
          />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-md border border-neutral-800 bg-neutral-900/70">Chars {chars.length}/3</span>
            <span className="text-xs px-2 py-1 rounded-md border border-neutral-800 bg-neutral-900/70">Others {totalOthers}/20</span>
            <button
              onClick={save}
              disabled={!meId || chars.length === 0 || totalOthers === 0}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Characters */}
        <section>
          <h2 className="font-semibold mb-2">Characters</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {loading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-2xl bg-neutral-900/50 border border-neutral-900 animate-pulse" />
                ))
              : characters.map((it) => {
                  const picked = chars.includes(it.cardId);
                  return (
                    <button
                      key={it.cardId}
                      onClick={() => toggleChar(it.cardId)}
                      className={[
                        "relative h-24 rounded-2xl text-left px-3 py-2",
                        "bg-neutral-900/60 hover:bg-neutral-900 border border-transparent hover:border-neutral-800",
                        picked ? "ring-2 ring-emerald-400/40" : "",
                      ].join(" ")}
                    >
                      <div className="text-[10px] opacity-70">#{it.cardId}</div>
                      <div className="font-semibold truncate">{it.code}</div>
                      <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-neutral-800/70 border border-neutral-800">
                        x{it.qty}
                      </span>
                    </button>
                  );
                })}
            {!loading && characters.length === 0 && (
              <div className="col-span-full py-8 text-center text-sm opacity-60 border border-dashed border-neutral-900 rounded-xl">
                ยังไม่มีการ์ดตัวละคร
              </div>
            )}
          </div>
        </section>

        {/* Supports & Events */}
        <section>
          <h2 className="font-semibold mb-2">Supports & Events</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {loading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-2xl bg-neutral-900/50 border border-neutral-900 animate-pulse" />
                ))
              : othersPool.map((it) => {
                  const cur = others[it.cardId] ?? 0;
                  const left = it.qty - cur;
                  return (
                    <div
                      key={it.cardId}
                      className="relative h-24 rounded-2xl px-3 py-2 bg-neutral-900/60 border border-neutral-900"
                    >
                      <div className="text-[10px] opacity-70">#{it.cardId}</div>
                      <div className="font-semibold truncate">{it.code}</div>

                      <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-neutral-800/70 border border-neutral-800">
                        owned {it.qty}
                      </span>

                      <div className="absolute bottom-2 right-2 flex items-center gap-2">
                        <button
                          onClick={() => decOther(it.cardId)}
                          className="w-7 h-7 grid place-items-center rounded-lg bg-neutral-850 hover:bg-neutral-800 border border-neutral-800"
                        >
                          −
                        </button>
                        <span className="min-w-[1.75rem] text-center text-sm">{cur}</span>
                        <button
                          onClick={() => incOther(it.cardId)}
                          disabled={left <= 0 || totalOthers >= 20}
                          className={[
                            "w-7 h-7 grid place-items-center rounded-lg",
                            left > 0 && totalOthers < 20
                              ? "bg-emerald-700 hover:bg-emerald-600"
                              : "bg-neutral-850 border border-neutral-800 opacity-50 cursor-not-allowed",
                          ].join(" ")}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
            {!loading && othersPool.length === 0 && (
              <div className="col-span-full py-8 text-center text-sm opacity-60 border border-dashed border-neutral-900 rounded-xl">
                ยังไม่มีการ์ดเสริมหรืออีเวนต์
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
