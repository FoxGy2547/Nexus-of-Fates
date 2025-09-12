// src/app/wish/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence, Variants } from "framer-motion";
import type { JSX } from "react";

/* ==================== types ==================== */
type MeResp =
  | { ok: boolean; user?: { id: number } }
  | { ok: false; error?: string };

type WalletResp =
  | { ok: boolean; nexusPoint: number; nexusDeal: number }
  | { error: string };

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

/* ==================== helpers ==================== */
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

const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.25 } },
};

const cardVariants: Variants = {
  initial: { y: 40, opacity: 0, scale: 0.95 },
  enter: (i: number) => ({
    y: 0,
    opacity: 1,
    scale: 1,
    transition: { delay: 0.08 * i, duration: 0.35 },
  }),
};

/* ==================== page ==================== */
export default function WishPage(): JSX.Element {
  const [userId, setUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [wallet, setWallet] = useState<{ nexusPoint: number; nexusDeal: number }>({
    nexusPoint: 0,
    nexusDeal: 0,
  });
  const [rolling, setRolling] = useState<boolean>(false);
  const [results, setResults] = useState<WishResult[] | null>(null);
  const [pity5, setPity5] = useState<number>(0);

  // โหลด user + wallet
  useEffect(() => {
    (async () => {
      try {
        const me = await getJSON<MeResp>("/api/me");
        const uid = me && "user" in me ? me.user?.id ?? 0 : 0;
        if (!uid) {
          setLoading(false);
          return;
        }
        setUserId(uid);

        // ถ้ามี endpoint /api/wallet (ตามที่เราเคยทำ) ดึงมาโชว์
        try {
          const w = await getJSON<WalletResp>(`/api/wallet?userId=${uid}`);
          if ("ok" in w && w.ok) {
            setWallet({ nexusDeal: w.nexusDeal, nexusPoint: w.nexusPoint });
          }
        } catch {
          // เงียบไว้—อาจยังไม่สร้าง /api/wallet ก็ไม่เป็นไร
        }
      } finally {
        setLoading(false);
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
          setWallet(r.wallet);
          setPity5(r.pity5);
        } else {
          alert(("error" in r && r.error) || "Wish failed");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Wish failed";
        alert(msg);
      } finally {
        setRolling(false);
      }
    },
    [userId, rolling]
  );

  const summary = useMemo(() => {
    if (!results) return "";
    const star5 = results.filter((x) => x.rarity === 5).length;
    const star4 = results.filter((x) => x.rarity === 4).length;
    return `★5 x${star5} • ★4 x${star4}`;
  }, [results]);

  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Wish</h1>
        <div className="ml-auto flex items-center gap-3 text-sm opacity-80">
          <span>NP: {wallet.nexusPoint}</span>
          <span>Deals: {wallet.nexusDeal}</span>
          <span>Pity5: {pity5}</span>
        </div>
      </header>

      {loading && <div className="opacity-70">Loading…</div>}

      {!loading && !userId && (
        <div className="opacity-70">กรุณาล็อกอินก่อนถึงจะกดสุ่มได้นะ</div>
      )}

      {!loading && userId && (
        <>
          <section className="rounded-xl border border-white/10 p-4 bg-black/20">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
                disabled={rolling}
                onClick={() => doWish(1)}
              >
                Wish x1
              </button>
              <button
                className="px-4 py-2 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50"
                disabled={rolling}
                onClick={() => doWish(10)}
              >
                Wish x10
              </button>
              <div className="ml-auto text-sm opacity-80">{summary}</div>
            </div>
          </section>

          <AnimatePresence>
            {results && (
              <motion.section
                key="results"
                initial="hidden"
                animate="show"
                exit="hidden"
                variants={backdropVariants}
                className="rounded-xl border border-white/10 p-4 bg-black/30"
              >
                <div className="font-semibold mb-3">ผลการสุ่ม</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {results.map((r, i) => (
                    <motion.div
                      key={`${r.kind}-${"id" in r ? r.id : i}-${i}`}
                      custom={i}
                      initial="initial"
                      animate="enter"
                      variants={cardVariants}
                      className={`rounded-lg p-3 border ${
                        r.rarity === 5 ? "border-yellow-400" : "border-violet-400"
                      } bg-black/40`}
                    >
                      <div className="text-xs opacity-70 mb-1">
                        {r.rarity === 5 ? "★5 Character" : "★4 Support/Event"}
                      </div>
                      <div className="aspect-[2/3] relative rounded overflow-hidden bg-neutral-900">
                        {/* แทนด้วยภาพจริงตาม id ของเธอภายหลังได้ */}
                        <Image
                          src={
                            r.kind === "char"
                              ? `/char_cards/${r.id}.png`
                              : `/cards/${r.id}.png`
                          }
                          alt={`${r.kind}-${"id" in r ? r.id : ""}`}
                          fill
                          className="object-contain"
                          unoptimized
                        />
                      </div>
                      <div className="mt-2 text-sm">
                        {r.kind.toUpperCase()} #{r.kind === "char" ? r.id : r.id}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </>
      )}
    </main>
  );
}
