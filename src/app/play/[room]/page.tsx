"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useGame } from "@/hooks/useGame";

/* ===================== local view-model (จาก state เกม) ===================== */
type Side = "p1" | "p2";
type DicePool = Record<string, number>;
type UnitVM = { code: string; attack: number; hp: number; element: string };
type ClientState = {
  mode?: "lobby" | "play";
  turn: Side;
  phaseNo?: number;
  hero: Record<Side, number>;
  dice: Record<Side, DicePool>;
  board: Record<Side, UnitVM[]>;
  hand: Record<Side, string[]>;
  ready?: { p1: boolean; p2: boolean };
};
type PlayersVM = {
  p1: { userId: string; name?: string | null; avatar?: string | null } | null;
  p2: { userId: string; name?: string | null; avatar?: string | null } | null;
};

/* ===================== meta จาก /api/cards ===================== */
type Element =
  | "Pyro" | "Hydro" | "Cryo" | "Electro"
  | "Geo" | "Anemo" | "Quantum" | "Imaginary" | "Neutral";

type CardMeta = {
  code: string;
  name: string;
  element: Element;
  attack: number;
  hp: number;
  ability: string;
  cost: number;
  type: string | null;
  rarity?: string | null;
  role?: string | null;
};
type CardMetaMap = Record<string, CardMeta>;

/* ===================== assets ===================== */
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
};

/* แผนที่รูปการ์ด (ชื่อไฟล์ตรงกับที่มีอยู่) */
const CARD_IMG: Record<string, string> = {
  BLAZE_KNIGHT: "/cards/Blaze Knight.png",
  CINDER_SCOUT: "/cards/Cinder Scout.png",
  FROST_ARCHER: "/cards/Frost Archer.png",
  ICE_WARDEN: "/cards/Ice Warden.png",
  MINDSHAPER: "/cards/Mindshaper.png",
  NEXUS_ADEPT: "/cards/Nexus Adept.png",
  STONE_BULWARK: "/cards/Stone Bulwark.png",
  THUNDER_COLOSSUS: "/cards/Thunder Colossus.png",
  TIDE_MAGE: "/cards/Tide Mage.png",
  VOID_SEER: "/cards/Void Seer.png",
  WAVECALLER: "/cards/Wavecaller.png",
  WINDBLADE_DUELIST: "/cards/Windblade Duelist.png",
  HEALING_AMULET: "/cards/Healing Amulet.png",
  BLAZING_SIGIL: "/cards/Blazing Sigil.png",
};

/* ===================== ชิ้น UI เล็ก ๆ ===================== */
function Pill({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded bg-neutral-800 text-xs">{children}</span>;
}
function DiceList({ dice }: { dice: DicePool }) {
  const items = Object.entries(dice || {}).filter(([, n]) => n > 0);
  if (!items.length) return <div className="opacity-60 text-sm">—</div>;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map(([k, v]) => (
        <Pill key={k}>
          {k}: {v}
        </Pill>
      ))}
    </div>
  );
}
function DiceTray({ dice }: { dice: DicePool }) {
  const diceArray = useMemo(() => {
    const arr: { el: string; id: string }[] = [];
    Object.entries(dice || {}).forEach(([el, cnt]) => {
      for (let i = 0; i < (cnt ?? 0); i++) arr.push({ el, id: `${el}-${i}` });
    });
    return arr.sort((a, b) => a.el.localeCompare(b.el));
  }, [dice]);
  if (!diceArray.length) {
    return (
      <div className="w-full rounded-lg border border-white/10 bg-black/30 grid place-items-center text-sm opacity-70 h-28">
        No dice
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {diceArray.map((d) => {
          const src = ELEMENT_ICON[d.el] ?? ELEMENT_ICON.Neutral;
          return (
            <div
              key={d.id}
              className="aspect-square rounded-md bg-neutral-900/40 border border-white/10 grid place-items-center"
              title={d.el}
            >
              <Image
                src={src}
                alt={d.el}
                width={48}
                height={48}
                className="w-10 h-10 object-contain"
                draggable={false}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
function FieldHeader({
  tag,
  name,
  avatar,
  right,
}: {
  tag: "P1" | "P2";
  name?: string | null;
  avatar?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-full overflow-hidden border border-white/20 bg-black/30 grid place-items-center">
        {avatar ? (
          <Image src={avatar} alt="" width={48} height={48} className="object-cover" />
        ) : (
          <span className="font-semibold">{tag}</span>
        )}
      </div>
      <div className="leading-tight">
        <div className="text-xs opacity-60">{tag}</div>
        <div className="font-medium">{name ?? "—"}</div>
      </div>
      <div className="ml-auto">{right}</div>
    </div>
  );
}

/* ===================== Frame renderer ===================== */
/** อัตราส่วนเฟรม 942×1389 */
const FRAME_W = 188;
const FRAME_H = Math.round(FRAME_W * (1389 / 942));
const FRAME_SRC = "/card_frame.png";

/** พิกัดอิงเฟรม — ตำแหน่งกึ่งกลาง (%) + ขนาดวงกลม (%) */
const POS = {
  el:   { cx: 83.4, cy: 12.0, d: 18.6 }, // ธาตุ ขวาบน
  atk:  { cx: 13.5, cy: 89.0, d: 19.4 }, // ATK ล่างซ้าย
  hp:   { cx: 85.8, cy: 89.0, d: 19.4 }, // HP ล่างขวา
  name: { cx: 50.0, cy: 72.0, w: 73.0, h: 8.2 }, // ชื่อกลาง
};
const textShadow = "0 1px 2px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.7)";

function CardBase({ code }: { code: string }) {
  const src = CARD_IMG[code];
  return src ? (
    <Image src={src} alt={code} fill className="object-cover rounded-lg" unoptimized />
  ) : (
    <div className="w-full h-full rounded-lg border border-white/20 bg-neutral-800 grid place-items-center text-sm">
      {code}
    </div>
  );
}
function CircleOverlay({
  cx, cy, dPct, children, className = "",
}: { cx: number; cy: number; dPct: number; children: React.ReactNode; className?: string }) {
  const size = `${dPct}%`;
  return (
    <div
      className={`absolute grid place-items-center ${className}`}
      style={{
        width: size,
        height: size,
        left: `${cx}%`,
        top: `${cy}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      {children}
    </div>
  );
}
function NameOverlay({
  cx, cy, wPct, hPct, children, className = "",
}: { cx: number; cy: number; wPct: number; hPct: number; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`absolute flex items-center justify-center text-center truncate ${className}`}
      style={{
        width: `${wPct}%`,
        height: `${hPct}%`,
        left: `${cx}%`,
        top: `${cy}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      {children}
    </div>
  );
}

/** การ์ดตัวละครที่มีเฟรม + overlay ข้อมูลจาก meta/u */
function CharacterCardFramed({ u, meta }: { u: UnitVM; meta?: CardMeta }) {
  const name = meta?.name ?? u.code.replaceAll("_", " ");
  const atk = (meta?.attack ?? u.attack) ?? 0;
  const hp  = (meta?.hp ?? u.hp) ?? 0;
  const element = (meta?.element ?? u.element) as Element;
  const icon = ELEMENT_ICON[element] ?? ELEMENT_ICON.Neutral;

  return (
    <div
      className="relative select-none"
      style={{ width: FRAME_W, height: FRAME_H }}
      title={`${name} — ATK ${atk} / HP ${hp} / ${element}`}
    >
      <CardBase code={u.code} />
      <Image src={FRAME_SRC} alt="frame" fill className="pointer-events-none object-cover" unoptimized />

      <CircleOverlay cx={POS.el.cx} cy={POS.el.cy} dPct={POS.el.d}>
        <Image src={icon} alt={element} fill sizes="100%" className="object-contain pointer-events-none" unoptimized />
      </CircleOverlay>

      <CircleOverlay cx={POS.atk.cx} cy={POS.atk.cy} dPct={POS.atk.d}>
        <span
          className="font-semibold text-white tabular-nums"
          style={{ fontSize: "clamp(12px, 3.2vw, 22px)", lineHeight: 1, textShadow, transform: "translateY(-2%)" }}
        >
          {atk}
        </span>
      </CircleOverlay>

      <CircleOverlay cx={POS.hp.cx} cy={POS.hp.cy} dPct={POS.hp.d}>
        <span
          className="font-semibold text-white tabular-nums"
          style={{ fontSize: "clamp(12px, 3.2vw, 22px)", lineHeight: 1, textShadow, transform: "translateY(-2%)" }}
        >
          {hp}
        </span>
      </CircleOverlay>

      <NameOverlay cx={POS.name.cx} cy={POS.name.cy} wPct={POS.name.w} hPct={POS.name.h}>
        <span
          className="font-medium"
          style={{
            color: "#000",
            fontSize: "clamp(10px,1vw,12px)",
            lineHeight: 1.05,
            letterSpacing: ".02em",
            textShadow: "none",
          }}
        >
          {name}
        </span>
      </NameOverlay>
    </div>
  );
}

/** การ์ดที่ไม่ใช่ตัวละคร (ไม่ใส่เฟรม) */
function SimpleCard({ code, meta }: { code: string; meta?: CardMeta }) {
  const name = meta?.name ?? code.replaceAll("_", " ");
  return (
    <div className="relative" style={{ width: FRAME_W, height: FRAME_H }} title={name}>
      <CardBase code={code} />
    </div>
  );
}

/* ===================== Fallback meta hook ===================== */
function useCardMetaMap(allCodes: string[]) {
  const [meta, setMeta] = useState<CardMetaMap>({});

  useEffect(() => {
    if (!allCodes.length) return;
    const wanted = Array.from(new Set(allCodes)); // unique list

    fetch(`/api/cards?codes=${encodeURIComponent(wanted.join(","))}`)
      .then(async (r) => {
        let data: unknown;
        try { data = await r.json(); } catch { data = null; }

        const asOk = (val: unknown): val is { ok: boolean; cards: CardMeta[] } =>
          typeof val === "object" && val !== null && "ok" in (val as Record<string, unknown>);

        const map: CardMetaMap = {};
        if (asOk(data) && Array.isArray((data as { cards: unknown }).cards)) {
          for (const c of (data as { cards: CardMeta[] }).cards) map[c.code] = c;
        } else {
          for (const code of wanted) {
            map[code] = {
              code,
              name: code.replaceAll("_", " "),
              element: "Neutral",
              attack: 0,
              hp: 0,
              ability: "",
              cost: 0,
              type: null,
            };
          }
        }
        setMeta(map);
      })
      .catch(() => {
        const map: CardMetaMap = {};
        for (const code of wanted) {
          map[code] = {
            code,
            name: code.replaceAll("_", " "),
            element: "Neutral",
            attack: 0,
            hp: 0,
            ability: "",
            cost: 0,
            type: null,
          };
        }
        setMeta(map);
      });
  }, [JSON.stringify(allCodes)]);

  return meta;
}

/* ===================== ช่วยตัดสินว่าเป็น “ตัวละคร” ===================== */
function isCharacterCard(meta: CardMeta | undefined, u: UnitVM) {
  if ((meta?.type ?? "").toLowerCase() === "character") return true;
  const atk = (meta?.attack ?? u.attack) ?? 0;
  const hp  = (meta?.hp ?? u.hp) ?? 0;
  return atk > 0 || hp > 0;
}

/* ===================== การ์ด 1 ใบบนบอร์ด ===================== */
function UnitCard({ u, meta }: { u: UnitVM; meta?: CardMeta }) {
  const character = isCharacterCard(meta, u);

  return (
    <div className="flex flex-col items-center">
      {character ? (
        <CharacterCardFramed u={u} meta={meta} />
      ) : (
        <>
          <SimpleCard code={u.code} meta={meta} />
          <div className="text-xs mt-1 opacity-80 text-center">{meta?.name ?? u.code.replaceAll("_", " ")}</div>
          <div className="text-xs opacity-70 text-center">
            ATK {(meta?.attack ?? u.attack) ?? 0} • HP {(meta?.hp ?? u.hp) ?? 0} • {meta?.element ?? u.element}
          </div>
        </>
      )}
    </div>
  );
}
function EmptySlot() {
  return (
    <div
      className="rounded-xl border border-dashed border-white/20 bg-transparent/10 grid place-items-center text-xs opacity-50"
      style={{ width: FRAME_W, height: FRAME_H }}
    >
      empty
    </div>
  );
}

/** แถวบอร์ด 3 ช่อง กลางเสมอ */
function BoardRow({ units, metaMap }: { units: UnitVM[]; metaMap: CardMetaMap }) {
  const slots = [0, 1, 2].map((i) => {
    const u = units[i];
    if (!u) return <EmptySlot key={`empty-${i}`} />;
    const meta = metaMap[u.code];
    return <UnitCard key={`${u.code}-${i}`} u={u} meta={meta} />;
  });
  return <div className="flex justify-center gap-3">{slots}</div>;
}

/* ===================== Page ===================== */
export default function PlayRoomPage() {
  const params = useParams<{ room: string }>();
  const roomId = useMemo(() => String(params.room || "").toUpperCase(), [params.room]);

  const { you, players, state, ready, endTurn, endPhase, playCard, attackActive } = useGame(roomId);

  const cs = (state as ClientState | null) ?? null;
  const ppl = (players as PlayersVM) ?? { p1: null, p2: null };
  const yourSide: Side = (you || "p1") as Side;
  const opponentSide: Side = yourSide === "p1" ? "p2" : "p1";
  const yourHero = cs?.hero?.[yourSide] ?? 30;

  // meta: รวมโค้ดที่อยู่บนบอร์ด + ในมือ ทั้งสองฝั่ง
  const codesForMeta = useMemo(() => {
    const b1 = (cs?.board?.p1 ?? []).map((u) => u.code);
    const b2 = (cs?.board?.p2 ?? []).map((u) => u.code);
    const h1 = cs?.hand?.p1 ?? [];
    const h2 = cs?.hand?.p2 ?? [];
    return Array.from(new Set([...b1, ...b2, ...h1, ...h2]));
  }, [cs?.board?.p1, cs?.board?.p2, cs?.hand?.p1, cs?.hand?.p2]);
  const metaMap = useCardMetaMap(codesForMeta);

  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Room: {roomId}</h1>
        <div className="text-sm opacity-70">You are: {you || "-"}</div>
      </header>

      {/* ===== LOBBY ===== */}
      {cs?.mode === "lobby" && (
        <section className="rounded-2xl border border-white/10 p-6 bg-black/20">
          <div className="flex items-center gap-4">
            <button className="px-5 py-2 rounded bg-emerald-600" onClick={ready}>
              Ready
            </button>
            <div className="text-sm">
              P1: {cs.ready?.p1 ? "✅" : "❌"} &nbsp;|&nbsp; P2: {cs.ready?.p2 ? "✅" : "❌"}
            </div>
          </div>
          <p className="text-xs opacity-60 mt-2">
            เมื่อทั้งสองฝั่ง Ready จะเริ่ม Phase 1 (ตัวละคร 3 ใบ • การ์ดอื่น 4 ใบ • Dice 10)
          </p>
        </section>
      )}

      {/* ===== PLAY ===== */}
      {cs?.mode === "play" && (
        <>
          {/* ---------- OPPONENT FIELD ---------- */}
          <section className="rounded-3xl border border-white/10 p-5 bg-black/20">
            <FieldHeader
              tag={opponentSide.toUpperCase() as "P1" | "P2"}
              name={ppl[opponentSide]?.name}
              avatar={ppl[opponentSide]?.avatar}
            />
            <div className="mt-4 rounded-lg bg-black/30 p-3">
              <div className="opacity-70 mb-1 text-sm">Opponent Board</div>
              <BoardRow units={(cs.board?.[opponentSide] ?? []).slice(0, 3)} metaMap={metaMap} />
            </div>
          </section>

          {/* ---------- Controls ---------- */}
          <section className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="font-semibold">
              {cs.turn === yourSide ? (
                <span className="text-emerald-400">Your turn</span>
              ) : (
                <span className="opacity-70">Opponent turn</span>
              )}
              <span className="ml-3 opacity-70">Phase #{cs.phaseNo ?? 1}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => attackActive()} className="px-3 py-1 rounded bg-amber-700">
                Attack
              </button>
              <button onClick={() => endTurn()} className="px-3 py-1 rounded bg-rose-700">
                End Turn
              </button>
              <button onClick={() => endPhase()} className="px-3 py-1 rounded bg-sky-700">
                End Phase
              </button>
            </div>
          </section>

          {/* ---------- YOUR FIELD ---------- */}
          <section className="rounded-3xl border border-white/10 p-5 bg-black/20">
            <FieldHeader
              tag={yourSide.toUpperCase() as "P1" | "P2"}
              name={ppl[yourSide]?.name}
              avatar={ppl[yourSide]?.avatar}
              right={<span className="text-xs opacity-70">Your Hero: {yourHero} HP</span>}
            />

            {/* board เรา: กึ่งกลางเสมอ */}
            <div className="mt-4 flex justify-center">
              <BoardRow units={(cs.board?.[yourSide] ?? []).slice(0, 3)} metaMap={metaMap} />
            </div>

            {/* Hand + Dice */}
            <div className="mt-6 grid grid-cols-12 gap-4">
              {/* Hand */}
              <div className="col-span-12 md:col-span-8 rounded-xl border border-white/10 bg-neutral-900/40 p-4">
                <div className="font-medium mb-2">Your Hand</div>
                <div className="flex flex-wrap gap-3">
                  {(cs.hand?.[yourSide]?.length ?? 0) > 0 ? (
                    cs.hand![yourSide]!.map((code, i) => {
                      const meta = metaMap[code];
                      const dummy: UnitVM = {
                        code,
                        attack: meta?.attack ?? 0,
                        hp: meta?.hp ?? 0,
                        element: (meta?.element ?? "Neutral") as string,
                      };
                      const character = isCharacterCard(meta, dummy);
                      return (
                        <button
                          key={`${code}-${i}`}
                          className="rounded-lg border border-white/10 bg-neutral-900/60 hover:bg-neutral-800 p-1"
                          onClick={() => playCard(i)}
                          title={`Play ${meta?.name ?? code}`}
                        >
                          {character ? (
                            <CharacterCardFramed u={dummy} meta={meta} />
                          ) : (
                            <SimpleCard code={code} meta={meta} />
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="text-sm opacity-70">Empty hand</div>
                  )}
                </div>
              </div>

              {/* Dice */}
              <div className="col-span-12 md:col-span-4 rounded-xl border border-white/10 bg-neutral-900/40 p-4">
                <div className="font-medium mb-2">Your Dice</div>
                <DiceTray dice={cs.dice?.[yourSide] ?? {}} />
                <div className="mt-2">
                  <DiceList dice={cs.dice?.[yourSide] ?? {}} />
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
