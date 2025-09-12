// src/app/wish/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import cardsDataJson from "@/data/cards.json";

/* ================= types ================= */
type MeResp = { ok: boolean; user?: { id: number } };

type WalletResp = {
  ok: boolean;
  nexusPoint: number;
  nexusDeal: number;
};

type WishResp = {
  ok: true;
  spentDeals: number;
  autoExchanged?: { pointsUsed: number; dealsGained: number };
  wallet: { nexusPoint: number; nexusDeal: number };
  results: Array<{ id: number; rarity: 3 | 4 | 5 }>; // character id only
};

type CardsData = typeof cardsDataJson & {
  characters: Array<{
    char_id: number;
    code: string;
    name: string;
    art: string;
  }>;
};

const cardsData = cardsDataJson as CardsData;

/* ================= helpers ================= */
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

function charMeta(id: number) {
  const c = (cardsData.characters as any[]).find((x) => x.char_id === id);
  return c ? { name: c.name || c.code, art: c.art } : { name: `#${id}`, art: "" };
}

function artUrl(art: string) {
  return encodeURI(`/char_cards/${art}`);
}

/* ================= visual bits ================= */
function StarRow({ rarity }: { rarity: 3 | 4 | 5 }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: rarity }).map((_, i) => (
        <div key={i} className={`w-3 h-3 rounded-full ${rarity === 5 ? "bg-amber-400" : rarity === 4 ? "bg-violet-400" : "bg-sky-300"}`} />
      ))}
    </div>
  );
}

function FireflyBG() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* glows */}
      <div className="absolute -top-10 -left-10 w-72 h-72 rounded-full blur-3xl bg-sky-500/20" />
      <div className="absolute top-20 right-10 w-72 h-72 rounded-full blur-3xl bg-indigo-500/20" />
      <div className="absolute bottom-10 left-1/3 w-96 h-96 rounded-full blur-[110px] bg-cyan-400/20" />
    </div>
  );
}

function Portal({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <motion.div
            className="relative w-[22rem] h-[22rem] rounded-full"
            initial={{ scale: 0.7, rotate: 0 }}
            animate={{ scale: [0.7, 1, 0.95, 1], rotate: 360 }}
            transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
            style={{
              background:
                "radial-gradient(closest-side, rgba(99,102,241,.35), transparent 70%), conic-gradient(from 0deg, rgba(56,189,248,.5), rgba(99,102,241,.6), rgba(56,189,248,.5))",
              boxShadow: "0 0 60px 20px rgba(56,189,248,.15)",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ResultCard({ id, rarity, delay = 0 }: { id: number; rarity: 3 | 4 | 5; delay?: number }) {
  const meta = useMemo(() => charMeta(id), [id]);
  const glow = rarity === 5 ? "shadow-amber-400/50" : rarity === 4 ? "shadow-violet-400/50" : "shadow-sky-300/40";
  const border = rarity === 5 ? "border-amber-400/70" : rarity === 4 ? "border-violet-400/70" : "border-sky-300/50";

  return (
    <motion.div
      initial={{ y: 40, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 120, damping: 12 }}
      className={`relative w-40 rounded-xl border ${border} bg-black/40 backdrop-blur-sm p-2 shadow-xl ${glow}`}
    >
      <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-neutral-900">
        {meta.art && (
          <Image src={artUrl(meta.art)} alt={meta.name} fill className="object-contain" unoptimized />
        )}
      </div>
      <div className="mt-2 text-sm font-medium truncate text-white/90 text-center">{meta.name}</div>
      <div className="mt-1 flex justify-center">
        <StarRow rarity={rarity} />
      </div>
    </motion.div>
  );
}

/* ================= main page ================= */
export default function WishPage() {
  const [userId, setUserId] = useState<number>(0);
  const [wallet, setWallet] = useState<{ nexusPoint: number; nexusDeal: number }>({ nexusPoint: 0, nexusDeal: 0 });

  const [pulling, setPulling] = useState(false);
  const [portal, setPortal] = useState(false);
  const [results, setResults] = useState<Array<{ id: number; rarity: 3 | 4 | 5 }>>([]);

  // boot
  useEffect(() => {
    (async () => {
      try {
        const me = await getJSON<MeResp>("/api/me");
        const uid = Number(me.user?.id ?? 0);
        setUserId(uid || 0);
        if (uid) {
          const w = await getJSON<WalletResp>(`/api/wallet?userId=${uid}`);
          if (w.ok) setWallet({ nexusPoint: w.nexusPoint, nexusDeal: w.nexusDeal });
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const doWish = useCallback(
    async (count: 1 | 10) => {
      if (!userId || pulling) return;
      setPulling(true);
      setResults([]);
      setPortal(true);

      try {
        // ถ้าไม่พอระบบฝั่งเซิร์ฟเวอร์จะลองแลก auto (อธิบายใน API)
        const resp = await postJSON<WishResp>("/api/gacha/wish", {
          userId,
          count,
          autoExchangeIfNeed: true,
        });

        // ใส่อนิเมชันพอร์ทัลสักพักแล้วค่อยเผยผล
        await new Promise((r) => setTimeout(r, count === 10 ? 1800 : 1100));
        setPortal(false);

        setResults(resp.results);
        setWallet(resp.wallet);
      } catch (e) {
        alert((e as Error).message || "Wish failed");
        setPortal(false);
      } finally {
        setPulling(false);
      }
    },
    [userId, pulling]
  );

  const bannerFace = useMemo(() => {
    // default showcase trio
    const picks = [7, 8, 10].map((id) => cardsData.characters.find((c) => c.char_id === id)).filter(Boolean) as any[];
    return picks.map((c) => ({ id: c.char_id, name: c.name || c.code, art: c.art }));
  }, []);

  return (
    <main className="relative min-h-screen bg-gradient-to-b from-sky-900 via-indigo-900 to-slate-950 text-white">
      <FireflyBG />
      <div className="absolute inset-0">
        <Portal active={portal} />
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="text-2xl font-semibold">Wanderlust Invocation</div>
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="opacity-70">Nexus Deal</span>
              <span className="font-semibold">{wallet.nexusDeal}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="opacity-70">Nexus Point</span>
              <span className="font-semibold">{wallet.nexusPoint}</span>
            </div>
          </div>
        </div>

        {/* Banner hero */}
        <section className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 relative rounded-2xl bg-white/5 border border-white/10 overflow-hidden">
            <div className="absolute inset-0 bg-[url('/stars.png')] bg-cover bg-center opacity-10" />
            <div className="p-6 relative z-10">
              <div className="text-xl font-semibold">Standard Wish</div>
              <div className="mt-1 opacity-80 text-sm max-w-[42ch]">
                Every 10 wishes is guaranteed to include at least one 4★ or higher item.
              </div>

              <div className="mt-6 flex gap-4">
                {bannerFace.map((f) => (
                  <div key={f.id} className="relative w-40">
                    <div className="relative w-full aspect-[2/3] rounded-xl overflow-hidden bg-black/40 border border-white/15">
                      <Image src={artUrl(f.art)} alt={f.name} fill className="object-contain" unoptimized />
                    </div>
                    <div className="mt-2 text-sm font-medium truncate text-white/90 text-center">{f.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="md:col-span-1">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-base font-semibold">Wish</div>
              <div className="mt-4 flex flex-col gap-3">
                <button
                  onClick={() => doWish(1)}
                  disabled={pulling}
                  className="rounded-xl bg-cyan-500/90 hover:bg-cyan-400 disabled:opacity-60 px-5 py-3 font-semibold"
                >
                  Wish ×1
                </button>
                <button
                  onClick={() => doWish(10)}
                  disabled={pulling}
                  className="rounded-xl bg-violet-500/90 hover:bg-violet-400 disabled:opacity-60 px-5 py-3 font-semibold"
                >
                  Wish ×10
                </button>
                <div className="mt-2 text-xs opacity-75">
                  ถ้า Nexus Deal ไม่พอ ระบบจะถาม/แลกจาก Nexus Point ให้อัตโนมัติ (ค่าแลกกำหนดในเซิร์ฟเวอร์)
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Results */}
        <AnimatePresence>
          {results.length > 0 && (
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-10 rounded-2xl border border-white/10 bg-black/30 p-5"
            >
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Results</div>
                <button
                  onClick={() => setResults([])}
                  className="text-sm px-3 py-1 rounded bg-white/10 hover:bg-white/20"
                >
                  Clear
                </button>
              </div>

              {results.length === 1 ? (
                <div className="mt-6 flex justify-center">
                  <ResultCard id={results[0].id} rarity={results[0].rarity} />
                </div>
              ) : (
                <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-4 place-items-center">
                  {results.map((r, i) => (
                    <ResultCard key={`${r.id}-${i}`} id={r.id} rarity={r.rarity} delay={i * 0.06 + 0.1} />
                  ))}
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
