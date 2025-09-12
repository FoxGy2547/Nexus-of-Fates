// src/app/wish/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import WishCinema, { WishItem } from "./WishCinema";
import { JSX } from "react/jsx-runtime";
import { useRouter } from "next/navigation";

/* helpers */
async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const txt = await r.text().catch(() => "");
  if (!r.ok) throw new Error(txt || r.statusText);
  return (txt ? JSON.parse(txt) : ({} as T)) as T;
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

/** path รูป */
function cardImg(art: string, kind: WishItem["kind"]): string {
  return encodeURI(kind === "character" ? `/char_cards/${art}` : `/cards/${art}`);
}

/* types */
type MeResp = { ok: boolean; user?: { id: number } };
type WalletResp = { ok: boolean; user: { nexusPoint: number; nexusDeal: number; pity5: number } };
type WishPostResp = {
  ok: boolean;
  items: WishItem[];
  user: { nexusPoint: number; nexusDeal: number; pity5: number };
};

export default function WishPage(): JSX.Element {
  const router = useRouter();
  const [userId, setUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [rolling, setRolling] = useState<boolean>(false);
  const [wallet, setWallet] = useState<{ np: number; deal: number; pity5: number }>({ np: 0, deal: 0, pity5: 0 });

  // ไอเท็มของ overlay (เปิดทันทีแม้ยังไม่มีผล → ใส่ [] ชั่วคราว)
  const [cinemaItems, setCinemaItems] = useState<WishItem[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const me = await getJSON<MeResp>("/api/me");
        const uid = Number(me.user?.id ?? 0);
        setUserId(uid || null);
        if (uid) {
          const w = await getJSON<WalletResp>(`/api/gacha/wish?userId=${uid}`);
          setWallet({ np: w.user.nexusPoint, deal: w.user.nexusDeal, pity5: w.user.pity5 });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const doWish = async (times: 1 | 10) => {
    if (!userId) return alert("กรุณาเข้าสู่ระบบก่อนสุ่ม");
    setRolling(true);

    // 1) เปิด overlay ก่อนเลย
    setCinemaItems([]); // waiting

    try {
      // 2) ยิง API
      const r = await postJSON<WishPostResp>("/api/gacha/wish", { userId, times, autoConvertNP: true });

      // 3) ป้อนผลเข้า overlay
      setCinemaItems(r.items);

      // อัปเดตกระเป๋า
      setWallet({ np: r.user.nexusPoint, deal: r.user.nexusDeal, pity5: r.user.pity5 });
    } catch (e) {
      setCinemaItems(null);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRolling(false);
    }
  };

  return (
    <main className="min-h-screen p-6">
      {/* Exit button */}
      <button
        onClick={() => router.push("/")}
        className="px-4 py-2 rounded bg-red-600 hover:bg-red-500"
        title="กลับหน้าแรก"
      >
        Exit
      </button>

      <section className="max-w-5xl mx-auto rounded-2xl p-5 bg-gradient-to-b from-[#0b1220] to-[#0b0f1a] border border-white/10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-700/20 px-3 py-1 text-emerald-300 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Standard Wish
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-6 items-stretch">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Wanderlust Invocation</h1>
            <p className="opacity-80 text-sm">
              Standard wishes have no time limit. Every 10 wishes is guaranteed to include at least one 4★ or higher item.
            </p>
            <button className="text-xs opacity-70 hover:opacity-100 underline underline-offset-4">View Details for more.</button>

            <div className="mt-4 text-sm opacity-80">
              <span className="mr-4">Nexus Point: <b>{wallet.np}</b></span>
              <span className="mr-4">Nexus Deal: <b>{wallet.deal}</b></span>
              <span>Pity5: <b>{wallet.pity5}</b></span>
            </div>
          </div>

          {/* banner */}
          <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-indigo-700/20 to-sky-500/10 border border-white/10 min-h-[180px]">
            <div className="absolute right-3 bottom-3 text-xs bg-black/60 px-2 py-1 rounded text-amber-300">★★★★★ Windblade Duelist</div>
            <Image
              src={cardImg("Windblade Duelist.png", "character")}
              alt="Windblade Duelist"
              fill
              className="object-contain opacity-70"
              unoptimized
              priority
            />
          </div>
        </div>

        {/* buttons */}
        <div className="mt-10 flex gap-6 justify-center">
          <button
            onClick={() => doWish(1)}
            disabled={!userId || loading || rolling}
            className="px-8 py-3 rounded-xl bg-neutral-800 border border-white/10 hover:border-white/20 disabled:opacity-40"
          >
            Wish ×1
            <div className="text-xs opacity-70">ใช้ Nexus Deal ×1</div>
          </button>

          <button
            onClick={() => doWish(10)}
            disabled={!userId || loading || rolling}
            className="px-8 py-3 rounded-xl bg-emerald-700/30 border border-emerald-500/50 hover:bg-emerald-700/40 disabled:opacity-40"
          >
            Wish ×10
            <div className="text-xs opacity-80">ใช้ Nexus Deal ×10</div>
          </button>
        </div>
      </section>

      {/* Overlay cinema */}
      <WishCinema
        open={!!cinemaItems}
        results={cinemaItems || []}
        onDone={() => setCinemaItems(null)}
      />
    </main>
  );
}
