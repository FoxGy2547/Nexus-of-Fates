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
  const userId = 1; // TODO: replace with session user id
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("My Deck");

  // selections
  const [chars, setChars] = useState<number[]>([]);
  const [others, setOthers] = useState<Record<number, number>>({}); // cardId -> count

  const characters = useMemo(() => items.filter(i => i.kind === "character"), [items]);
  const othersPool = useMemo(() => items.filter(i => i.kind !== "character"), [items]);
  const totalOthers = useMemo(() => Object.values(others).reduce((a, b) => a + b, 0), [others]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/inventory?userId=${userId}`, { cache: "no-store" });
      const json = await res.json();
      setItems((json?.items ?? []) as Item[]);
      setLoading(false);
    })();
  }, [userId]);

  function toggleChar(cardId: number) {
    const picked = new Set(chars);
    if (picked.has(cardId)) {
      picked.delete(cardId);
      setChars(Array.from(picked));
      return;
    }
    if (chars.length >= 3) return;
    setChars([...chars, cardId]);
  }

  function incOther(cardId: number) {
    const max = items.find(i => i.cardId === cardId)?.qty ?? 0;
    const cur = others[cardId] ?? 0;
    if (totalOthers >= 20) return;
    if (cur >= max) return;
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
    const payload = {
      userId,
      name,
      characters: chars,
      cards: Object.entries(others).map(([k, v]) => ({ cardId: Number(k), count: v })),
    };
    const res = await fetch("/api/deck", { method: "POST", body: JSON.stringify(payload) });
    const json = await res.json();
    if (json?.ok) {
      alert(`Saved deck #${json.deckId}`);
      // reset optional
      // setChars([]); setOthers({});
    } else {
      alert(`Error: ${json?.error ?? "save failed"}`);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 backdrop-blur bg-neutral-900/60 border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm opacity-75">Deck name</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Badge>Characters {chars.length}/3</Badge>
            <Badge>Others {totalOthers}/20</Badge>
            <button
              onClick={save}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[.98] transition"
              disabled={chars.length === 0 || totalOthers === 0}
            >
              Save
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        <section className="flex-1 space-y-6">
          <Block title="Characters">
            {loading ? (
              <SkeletonGrid />
            ) : (
              <Grid>
                {characters.map(it => {
                  const picked = chars.includes(it.cardId);
                  return (
                    <button
                      key={it.cardId}
                      onClick={() => toggleChar(it.cardId)}
                      className={[
                        "relative p-3 rounded-2xl text-left border transition",
                        picked
                          ? "border-emerald-400 ring-2 ring-emerald-400/40"
                          : "border-neutral-700 hover:border-neutral-500",
                        "bg-gradient-to-b from-neutral-900/70 to-neutral-900/30",
                      ].join(" ")}
                    >
                      <div className="text-[10px] opacity-70">#{it.cardId}</div>
                      <div className="font-semibold leading-tight break-words">{it.code}</div>
                      <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-neutral-800/70 border border-neutral-700">
                        x{it.qty}
                      </span>
                      {picked && (
                        <div className="absolute inset-0 rounded-2xl ring-2 ring-emerald-400/50 pointer-events-none" />
                      )}
                    </button>
                  );
                })}
                {characters.length === 0 && <EmptyNote text="ยังไม่มีการ์ดตัวละคร" />}
              </Grid>
            )}
          </Block>

          <Block title="Supports & Events">
            {loading ? (
              <SkeletonGrid />
            ) : (
              <Grid>
                {othersPool.map(it => {
                  const cur = others[it.cardId] ?? 0;
                  const left = it.qty - cur;
                  return (
                    <div
                      key={it.cardId}
                      className="relative p-3 rounded-2xl border border-neutral-700 bg-gradient-to-b from-neutral-900/70 to-neutral-900/30"
                    >
                      <div className="text-[10px] opacity-70">#{it.cardId}</div>
                      <div className="font-semibold leading-tight break-words mb-6">{it.code}</div>

                      <div className="absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-neutral-800/70 border border-neutral-700">
                        owned {it.qty}
                      </div>

                      <div className="absolute bottom-2 right-2 flex items-center gap-2">
                        <button
                          onClick={() => decOther(it.cardId)}
                          className="w-7 h-7 grid place-items-center rounded-lg bg-neutral-800 hover:bg-neutral-700"
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
                              : "bg-neutral-800 opacity-50 cursor-not-allowed",
                          ].join(" ")}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
                {othersPool.length === 0 && <EmptyNote text="ยังไม่มีการ์ดเสริมหรืออีเวนต์" />}
              </Grid>
            )}
          </Block>
        </section>

        <aside className="w-[22rem] shrink-0 space-y-6">
          <div className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40">
            <h3 className="font-semibold mb-3">Chosen Characters</h3>
            <ol className="space-y-2 text-sm">
              {[0, 1, 2].map(i => (
                <li key={i} className="px-2 py-1 rounded-lg bg-neutral-900/70 border border-neutral-800">
                  {chars[i]
                    ? `#${chars[i]} — ${characters.find(c => c.cardId === chars[i])?.code ?? ""}`
                    : "— empty —"}
                </li>
              ))}
            </ol>
          </div>

          <div className="p-4 rounded-2xl border border-neutral-800 bg-neutral-900/40">
            <h3 className="font-semibold mb-3">Chosen Others ({totalOthers}/20)</h3>
            <ul className="space-y-1 text-sm max-h-[45vh] overflow-auto pr-1">
              {Object.entries(others).map(([cid, cnt]) => (
                <li key={cid} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {othersPool.find(o => o.cardId === Number(cid))?.code ?? `#${cid}`}
                  </span>
                  <span className="opacity-90">x{cnt}</span>
                </li>
              ))}
              {totalOthers === 0 && <li className="opacity-60">— empty —</li>}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}

/* ---------- UI helpers ---------- */

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">{children}</div>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-1 rounded-md border border-neutral-700 bg-neutral-900/70">
      {children}
    </span>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="col-span-full py-8 text-center text-sm opacity-60 border border-dashed border-neutral-800 rounded-xl">
      {text}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="h-28 rounded-2xl border border-neutral-800 bg-neutral-900/50 animate-pulse"
        />
      ))}
    </div>
  );
}
