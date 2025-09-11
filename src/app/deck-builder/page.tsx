"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";

/* ============ types ============ */

type Kind = "character" | "support" | "event";

type InventoryItem = {
  cardId: number; // 1..12 (characters) หรือ 101..103 (supports/events)
  code: string;   // เช่น BLAZING_SIGIL
  kind: Kind;
  qty: number;    // จำนวนที่ผู้เล่นมี
};

type InventoryResponse = { items: InventoryItem[] } | { error: string };
type SaveBody = {
  userId: number;
  name: string;
  characters: number[]; // 1..12
  cards: { cardId: number; count: number }[]; // 101..103
};
type SaveResponse = { ok: true; deckId: number } | { error: string };
type MeResponse = { userId: number } | { error: string };
type OthersState = Record<number, number>;

/* ============ helpers ============ */

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg =
      (json as { error?: string }).error ?? res.statusText ?? "Request failed";
    throw new Error(msg);
  }
  return json as T;
}

/** "WAVECALLER" -> "Wavecaller", "WINDBLADE_DUELIST" -> "Windblade Duelist" */
function codeToPrettyName(code: string): string {
  const parts = code.includes("_") ? code.split("_") : [code];
  return parts
    .map((p) => {
      const s = p.toLowerCase();
      return s.charAt(0).toUpperCase() + s.slice(1);
    })
    .join(" ");
}

/** คืน path รูปใน /public ตามชนิดการ์ด (เข้ารหัสกันช่องว่าง/อักขระพิเศษ) */
function cardImagePath(code: string, kind: Kind): string {
  const pretty = codeToPrettyName(code); // e.g. "Blaze Knight"
  const raw =
    kind === "character"
      ? `/cards/char_cards/${pretty}.png`
      : `/cards/${pretty}.png`;
  return encodeURI(raw); // -> /cards/char_cards/Blaze%20Knight.png
}

/* ============ Page (wrap Suspense) ============ */

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen p-6">
          <div className="opacity-60">Loading deck builder…</div>
        </main>
      }
    >
      <DeckBuilderInner />
    </Suspense>
  );
}

/* ============ Inner component ============ */

function DeckBuilderInner() {
  const params = useSearchParams();
  const router = useRouter();

  // user ที่ใช้ inventory: query ?userId=… > /api/me
  const [userId, setUserId] = useState<number | null>(null);

  // สินค้าทั้งหมดที่ user มี (แยกไว้สองชุดเพื่อ UI)
  const [inv, setInv] = useState<InventoryItem[]>([]);
  const characters = useMemo(
    () => inv.filter((x) => x.kind === "character"),
    [inv]
  );
  const othersPool = useMemo(
    () => inv.filter((x) => x.kind !== "character"),
    [inv]
  );

  // ตัวเลือกปัจจุบัน
  const [deckName, setDeckName] = useState<string>("My Deck");
  const [chars, setChars] = useState<number[]>([]); // เลือกตัวละคร (id 1..12)
  const [others, setOthers] = useState<OthersState>({}); // {101:3,102:1,...}

  const totalOthers = useMemo(
    () => Object.values(others).reduce((a, b) => a + b, 0),
    [others]
  );

  /* ---------- resolve userId ---------- */
  useEffect(() => {
    const inQuery = Number(params.get("userId") ?? "0");
    if (Number.isFinite(inQuery) && inQuery > 0) {
      setUserId(inQuery);
      return;
    }
    // fallback: เรียก /api/me
    fetchJSON<MeResponse>("/api/me")
      .then((res) => {
        if ("error" in res) throw new Error(res.error);
        setUserId(res.userId);
      })
      .catch((e) => {
        alert(`me route failed: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [params]);

  /* ---------- load inventory ---------- */
  useEffect(() => {
    if (!userId) return;
    fetchJSON<InventoryResponse>(`/api/inventory?userId=${userId}`)
      .then((res) => {
        if ("error" in res) throw new Error(res.error);
        setInv(res.items);
      })
      .catch((e) => {
        alert(
          `load inventory failed: ${e instanceof Error ? e.message : String(e)}`
        );
      });
  }, [userId]);

  /* ---------- character pick toggle ---------- */
  function toggleChar(id: number) {
    setChars((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev; // เต็ม 3
      return [...prev, id];
    });
  }

  /* ---------- others add/remove ---------- */
  function canAdd(owned: number, current: number): boolean {
    return totalOthers < 20 && current < owned;
  }

  function addOne(cardId: number, owned: number) {
    setOthers((prev) => {
      const cur = prev[cardId] ?? 0;
      if (!canAdd(owned, cur)) return prev;
      return { ...prev, [cardId]: cur + 1 };
    });
  }

  function removeOne(cardId: number) {
    setOthers((prev) => {
      const cur = prev[cardId] ?? 0;
      if (cur <= 0) return prev;
      const next: OthersState = { ...prev, [cardId]: cur - 1 };
      if (next[cardId] === 0) delete next[cardId];
      return next;
    });
  }

  /* ---------- save ---------- */
  async function onSave() {
    try {
      if (!userId) throw new Error("missing userId");
      const cards: { cardId: number; count: number }[] = Object.entries(
        others
      )
        .map(([k, v]) => ({ cardId: Number(k), count: v }))
        .filter((x) => x.count > 0);

      const body: SaveBody = {
        userId,
        name: deckName.trim() || "My Deck",
        characters: [...chars],
        cards,
      };

      const res = await fetchJSON<SaveResponse>("/api/deck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if ("error" in res) throw new Error(res.error);
      alert("Saved!");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`save failed: ${msg}`);
    }
  }

  const canSave = chars.length <= 3 && totalOthers <= 20;

  /* ============ UI ============ */

  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <input
          className="px-3 py-2 rounded bg-neutral-900 border border-white/10 w-64"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          placeholder="My Deck"
        />
        <span className="text-sm opacity-75">Chars {chars.length}/3</span>
        <span className="text-sm opacity-75">Others {totalOthers}/20</span>
        <button
          className={`ml-auto px-4 py-2 rounded ${
            canSave
              ? "bg-emerald-600 hover:bg-emerald-500"
              : "bg-neutral-700 opacity-60 cursor-not-allowed"
          }`}
          disabled={!canSave}
          onClick={onSave}
        >
          Save
        </button>
      </div>

      {/* Characters */}
      <section>
        <h2 className="font-semibold mb-2">Characters</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {characters.map((it) => {
            const picked = chars.includes(it.cardId);
            const src = cardImagePath(it.code, "character");
            return (
              <button
                key={it.cardId}
                type="button"
                onClick={() => toggleChar(it.cardId)}
                className={[
                  "relative h-32 rounded-2xl overflow-hidden text-left",
                  "bg-neutral-900/60 border",
                  picked
                    ? "border-emerald-400 ring-2 ring-emerald-400/40"
                    : "border-neutral-900 hover:border-neutral-800",
                ].join(" ")}
                aria-label={it.code}
              >
                <Image
                  src={src}
                  alt={it.code}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="(max-width: 768px) 33vw, (max-width: 1024px) 20vw, 16vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/10" />
                <div className="absolute top-1 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/55">
                  #{it.cardId}
                </div>
                <span className="absolute top-1 right-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60">
                  x{it.qty}
                </span>
                <div className="absolute left-2 bottom-1 text-xs font-semibold drop-shadow">
                  {codeToPrettyName(it.code)}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Supports & Events */}
      <section>
        <h2 className="font-semibold mb-2">Supports &amp; Events</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {othersPool.map((it) => {
            const cur = others[it.cardId] ?? 0;
            const left = it.qty - cur;
            const src = cardImagePath(it.code, it.kind);
            const disabled = !(totalOthers < 20 && left > 0);

            return (
              <button
                key={it.cardId}
                type="button"
                onClick={() => addOne(it.cardId, it.qty)}
                disabled={disabled}
                className={[
                  "relative h-28 rounded-2xl overflow-hidden border text-left",
                  "bg-neutral-900/60",
                  disabled
                    ? "border-neutral-900 opacity-60 grayscale"
                    : "border-neutral-900 hover:brightness-110",
                ].join(" ")}
                aria-label={`add ${it.code}`}
              >
                <Image
                  src={src}
                  alt={it.code}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="(max-width: 768px) 33vw, (max-width: 1024px) 20vw, 16vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/20" />
                <div className="absolute top-1 left-2 flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/55">
                    #{it.cardId}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-black/55">
                    owned {it.qty}
                  </span>
                </div>
                <div className="absolute left-2 bottom-2 text-xs font-semibold drop-shadow">
                  {codeToPrettyName(it.code)}
                </div>

                {/* ปุ่มลบ (เฉพาะตอนเลือกแล้ว) */}
                {cur > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeOne(it.cardId);
                    }}
                    className="absolute top-1 right-1 w-7 h-7 grid place-items-center rounded-lg bg-black/60 hover:bg-black/70 border border-white/10"
                    aria-label="remove one"
                  >
                    −
                  </button>
                )}

                {/* counter ที่เลือกแล้ว */}
                <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-lg text-sm bg-black/60 border border-white/10">
                  {cur}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
