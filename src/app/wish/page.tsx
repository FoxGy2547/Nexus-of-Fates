// src/app/wish/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import WishOverlay, { type WishResult } from "./WishOverlay";
import { useRouter } from "next/navigation";

/* ===== helpers ===== */
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text().catch(() => "");
  if (!r.ok) throw new Error(txt || r.statusText);
  return (txt ? JSON.parse(txt) : ({} as T)) as T;
}
function stableUserId(session: ReturnType<typeof useSession>["data"]) {
  const raw = (session?.user as { id?: string | null } | null)?.id ?? null;
  if (raw) return Number(raw);
  // ถ้าบ้านไหนใช้ users.id เป็น int (จาก Discord sync) จะต้องล็อกอินเพื่อสุ่ม
  return 0;
}

/* ===== types ===== */
type WishResp = { ok: boolean; results: WishResult[] };

/* ===== page ===== */
export default function WishPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const userId = useMemo(() => stableUserId(session), [session]);

  const [pending, setPending] = useState(false);
  const [overlay, setOverlay] = useState<WishResult[] | null>(null);

  useEffect(() => {
    // ไม่ล็อกอินให้เด้งไปหน้าแรก (หรือจะให้สุ่ม guest ก็เพิ่มเองได้)
    if (!userId) return;
  }, [userId]);

  async function doWish(count: 1 | 10) {
    if (!userId) {
      alert("ล็อกอินก่อนค่อยสุ่มสิ!");
      return;
    }
    try {
      setPending(true);
      const res = await postJSON<WishResp>("/api/gacha/wish", { count, userId });
      setOverlay(res.results);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-gradient-to-b from-[#10192a] to-[#0a0f1a] text-white p-6">
      {/* Header ของตู้แบบเรียบๆ พอให้ฟีล */}
      <div className="mx-auto max-w-5xl rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02]">
        <div className="grid md:grid-cols-[1.1fr,1.2fr]">
          <div className="p-6">
            <div className="inline-flex items-center gap-2 px-2 py-1 bg-white/10 rounded-full text-[12px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Standard Wish
            </div>
            <h2 className="text-3xl font-bold mt-3">Wanderlust Invocation</h2>
            <p className="text-white/70 mt-3 text-[14px] leading-6">
              Standard wishes have no time limit. Every 10 wishes is guaranteed to include at least one 4★ or
              higher item.
            </p>
            <button
              className="mt-4 text-[12px] underline underline-offset-4 text-white/70 hover:text-white"
              onClick={() => alert("ไว้ค่อยทำหน้า Details นะ")}
            >
              View Details for more.
            </button>
          </div>
          <div className="relative h-[220px] md:h-[260px] bg-gradient-to-br from-indigo-600/20 to-sky-400/10">
            <Image
              src="/char_cards/windblade_duelist.png"
              alt="Windblade Duelist"
              fill
              className="object-contain p-4"
              unoptimized
            />
            <div className="absolute right-3 bottom-3 text-[12px] px-2 py-1 rounded-full bg-black/50 border border-white/10">
              <span className="mr-2 text-[#f6c14a]">★★★★★</span> Windblade Duelist
            </div>
          </div>
        </div>
      </div>

      {/* ปุ่มสุ่ม */}
      <div className="mx-auto max-w-5xl flex items-center justify-center gap-6 mt-10">
        <button
          className="px-8 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50"
          onClick={() => doWish(1)}
          disabled={pending}
        >
          <div className="text-center">
            <div className="font-semibold">Wish ×1</div>
            <div className="text-[11px] opacity-70 mt-0.5">ใช้ Nexus Deal ×1</div>
          </div>
        </button>
        <button
          className="px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
          onClick={() => doWish(10)}
          disabled={pending}
        >
          <div className="text-center">
            <div className="font-semibold">Wish ×10</div>
            <div className="text-[11px] opacity-90 mt-0.5">ใช้ Nexus Deal ×10</div>
          </div>
        </button>
      </div>

      {/* โอเวอร์เลย์อนิเมชัน */}
      {overlay && (
        <WishOverlay
          results={overlay}
          onClose={() => {
            setOverlay(null);
            // อยากรีเฟรชหน้าหรือไปหน้า history ค่อยเติม
          }}
        />
      )}
    </main>
  );
}
