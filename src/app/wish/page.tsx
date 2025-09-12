// src/app/wish/page.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";

type MeResp =
  | { ok: boolean; user?: { id: number } }
  | { ok: false; error?: string };

type WishResult =
  | { kind: "char"; id: number; rarity: 5 }
  | { kind: "card"; id: number; rarity: 4 };

type WishResp =
  | {
      ok: true;
      spentDeals: number;
      wallet: { nexusPoint: number; nexusDeal: number };
      pity5: number;
      results: WishResult[];
    }
  | { error: string };

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const txt = await r.text().catch(() => "");
  if (!r.ok) throw new Error(txt || r.statusText);
  return (txt ? JSON.parse(txt) : ({} as unknown)) as T;
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
  return (txt ? JSON.parse(txt) : ({} as unknown)) as T;
}

export default function WishPage() {
  const [userId, setUserId] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const [results, setResults] = useState<WishResult[] | null>(null);

  // banner info (ใส่/แก้เองตามต้องการได้)
  const featured = {
    id: 4,
    name: "Windblade Duelist",
    art: "/char_cards/Windblade_Duelist.png",
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await getJSON<MeResp>("/api/me");
        const uid = me && "user" in me ? me.user?.id ?? 0 : 0;
        if (uid) setUserId(uid);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const doWish = useCallback(
    async (count: 1 | 10) => {
      if (!userId || rolling) return;
      setRolling(true);
      try {
        const r = await postJSON<WishResp>("/api/gacha/wish", {
          userId,
          count,
          autoExchangeIfNeed: true,
        });
        if ("ok" in r && r.ok) {
          setResults(r.results);
        } else {
          alert(("error" in r && r.error) || "Wish failed");
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : "Wish failed");
      } finally {
        setRolling(false);
      }
    },
    [userId, rolling]
  );

  const summary = useMemo(() => {
    if (!results) return "";
    const s5 = results.filter((x) => x.rarity === 5).length;
    const s4 = results.filter((x) => x.rarity === 4).length;
    return `★5 x${s5} • ★4 x${s4}`;
  }, [results]);

  return (
    <main className="min-h-screen relative overflow-hidden bg-gradient-to-b from-sky-900/60 via-indigo-900/60 to-black text-white">
      {/* แบนเนอร์หลัก */}
      <section className="max-w-6xl mx-auto pt-10 px-4">
        <h1 className="text-3xl font-bold mb-4">Wish</h1>

        <div className="relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
          <div className="grid lg:grid-cols-[2fr_3fr]">
            {/* บล็อกข้อความซ้าย */}
            <div className="p-6 lg:p-8 flex flex-col gap-3">
              <span className="inline-block px-3 py-1 rounded-full bg-indigo-600/80 text-sm font-semibold w-max">
                Standard Wish
              </span>
              <h2 className="text-4xl font-extrabold tracking-tight">Wanderlust Invocation</h2>
              <p className="text-white/80">
                Standard wishes have no time limit. Every 10 wishes is guaranteed to include at least one 4★ or higher item.
              </p>
              <div className="mt-3 text-sm text-white/70">View Details for more.</div>
            </div>

            {/* รูปตัวเด่นขวา */}
            <div className="relative min-h-[320px] bg-gradient-to-tr from-indigo-800/40 to-sky-600/30">
              <Image
                src={featured.art}
                alt={featured.name}
                fill
                priority
                unoptimized
                className="object-contain object-center scale-[0.95]"
              />
              <div className="absolute bottom-3 right-4 text-right">
                <div className="inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-sm">
                  <span className="text-amber-300">★ ★ ★ ★ ★</span>
                  <span className="opacity-80">{featured.name}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ปุ่ม Wish ล่างกึ่งกลาง */}
        <div className="relative">
          <div className="pointer-events-none h-8" />
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-16 w-full max-w-2xl">
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={() => doWish(1)}
                disabled={!userId || rolling}
                className="w-60 h-16 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/20 shadow-lg backdrop-blur-md transition
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-lg font-semibold">Wish ×1</div>
                <div className="text-xs opacity-80">ใช้ Nexus Deal ×1</div>
              </button>
              <button
                onClick={() => doWish(10)}
                disabled={!userId || rolling}
                className="w-60 h-16 rounded-2xl bg-emerald-600/90 hover:bg-emerald-500 border border-white/20 shadow-xl transition
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-lg font-extrabold">Wish ×10</div>
                <div className="text-xs opacity-90">ใช้ Nexus Deal ×10</div>
              </button>
            </div>
          </div>
          <div className="h-20" />
        </div>
      </section>

      {/* แสดงผลการสุ่มแบบเรียบง่าย */}
      {results && (
        <section className="max-w-6xl mx-auto mt-24 px-4">
          <div className="text-sm opacity-80 mb-2">{summary}</div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {results.map((r, i) => (
              <div
                key={`${r.kind}-${r.id}-${i}`}
                className={`p-3 rounded-xl border bg-black/30 ${
                  r.rarity === 5 ? "border-amber-400/60" : "border-indigo-300/40"
                }`}
              >
                <div className="aspect-[2/3] rounded-lg bg-white/5 mb-2 flex items-center justify-center text-2xl">
                  {r.kind === "char" ? "CHAR " + r.id : "CARD " + r.id}
                </div>
                <div className="text-sm font-medium truncate">
                  {r.kind === "char" ? `Character #${r.id}` : `Support/Event #${r.id}`}
                </div>
                <div className="text-xs opacity-80">{r.rarity === 5 ? "★★★★★" : "★★★★"}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
