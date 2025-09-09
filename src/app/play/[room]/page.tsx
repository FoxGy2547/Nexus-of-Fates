// src/app/play/[room]/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  useGame,
  type ClientState,
  type Side,
  type DicePool,
  type UnitVM,
} from "@/hooks/useGame";
import cardsDataJson from "@/data/cards.json";

/* ===================== types from cards.json ===================== */
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
  Infinite: "/dice/infinite.png",
};

// สร้างแผนที่ code -> path โดยอาศัย art จาก cards.json (ไม่ hardcode)
const CARD_IMG: Record<string, string> = Object.fromEntries(
  [
    ...cardsData.characters,
    ...cardsData.supports,
    ...cardsData.events,
  ].map((c) => [c.code, `/cards/${c.art}`]),
);

/* ===================== small UI bits ===================== */
function Pill({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded bg-neutral-800 text-xs">{children}</span>;
}
function sortWithPriority(keys: string[], priority: string[]) {
  const at = (k: string) => {
    const i = priority.indexOf(k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...keys].sort((a, b) => (at(a) - at(b)) || a.localeCompare(b));
}
function DiceList({ dice, priority }: { dice: DicePool; priority: string[] }) {
  const items = Object.entries(dice || {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort(([a], [b]) => (sortWithPriority([a, b], priority)[0] === a ? -1 : 1));
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
function DiceTray({ dice, priority }: { dice: DicePool; priority: string[] }) {
  const arr: { el: string; id: string }[] = [];
  for (const [el, n] of Object.entries(dice || {})) {
    for (let i = 0; i < (n ?? 0); i++) arr.push({ el, id: `${el}-${i}` });
  }
  arr.sort((a, b) => (sortWithPriority([a.el, b.el], priority)[0] === a.el ? -1 : 1));
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      {arr.length ? (
        <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {arr.map((d) => (
            <div
              key={d.id}
              className="aspect-square rounded-md bg-neutral-900/40 border border-white/10 grid place-items-center"
              title={d.el}
            >
              <Image
                src={ELEMENT_ICON[d.el] ?? ELEMENT_ICON.Neutral}
                alt={d.el}
                width={48}
                height={48}
                className="w-10 h-10 object-contain"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="h-28 grid place-items-center text-sm opacity-70">No dice</div>
      )}
    </div>
  );
}

/* ===================== framed character card ===================== */
const FRAME_W = 188;
const FRAME_H = 277;
const FRAME_SRC = "/card_frame.png";
const POS = {
  el: { cx: 83.4, cy: 12, d: 18.6 },
  atk: { cx: 13.5, cy: 89, d: 19.4 },
  hp: { cx: 85.8, cy: 89, d: 19.4 },
  name: { cx: 50, cy: 72, w: 73, h: 8.2 },
};
const textShadow = "0 1px 2px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.7)";

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
function CircleOverlay({ cx, cy, dPct, children }: { cx: number; cy: number; dPct: number; children: React.ReactNode }) {
  const size = `${dPct}%`;
  return (
    <div
      className="absolute grid place-items-center"
      style={{ width: size, height: size, left: `${cx}%`, top: `${cy}%`, transform: "translate(-50%,-50%)" }}
    >
      {children}
    </div>
  );
}
function NameOverlay({
  cx,
  cy,
  wPct,
  hPct,
  children,
}: {
  cx: number;
  cy: number;
  wPct: number;
  hPct: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute flex items-center justify-center text-center truncate"
      style={{ width: `${wPct}%`, height: `${hPct}%`, left: `${cx}%`, top: `${cy}%`, transform: "translate(-50%,-50%)" }}
    >
      {children}
    </div>
  );
}
function CharacterCardFramed({ u }: { u: UnitVM }) {
  const icon = ELEMENT_ICON[u.element] ?? ELEMENT_ICON.Neutral;
  const display = u.code.replaceAll("_", " ");
  return (
    <div className="relative select-none" style={{ width: FRAME_W, height: FRAME_H }}>
      <CardBase code={u.code} />
      <Image src={FRAME_SRC} alt="frame" fill className="pointer-events-none object-cover" unoptimized />
      <CircleOverlay cx={POS.el.cx} cy={POS.el.cy} dPct={POS.el.d}>
        <Image src={icon} alt={u.element} fill sizes="100%" className="object-contain pointer-events-none" unoptimized />
      </CircleOverlay>
      <CircleOverlay cx={POS.atk.cx} cy={POS.atk.cy} dPct={POS.atk.d}>
        <span className="font-semibold text-white tabular-nums" style={{ fontSize: "22px", textShadow }}>
          {u.attack}
        </span>
      </CircleOverlay>
      <CircleOverlay cx={POS.hp.cx} cy={POS.hp.cy} dPct={POS.hp.d}>
        <span className="font-semibold text-white tabular-nums" style={{ fontSize: "22px", textShadow }}>
          {u.hp}
        </span>
      </CircleOverlay>
      <NameOverlay cx={POS.name.cx} cy={POS.name.cy} wPct={POS.name.w} hPct={POS.name.h}>
        <span className="font-medium" style={{ color: "#000", fontSize: 12, lineHeight: 1.05, letterSpacing: ".02em" }}>
          {display}
        </span>
      </NameOverlay>
      <div className="absolute left-2 top-2 text-[11px] bg-black/60 rounded px-1 text-white">ULT {(u.gauge ?? 0)}/3</div>
    </div>
  );
}

/* ===================== board ===================== */
function UnitCard({
  u,
  onClick,
  hl,
  refCb,
}: {
  u: UnitVM;
  onClick?: () => void;
  hl?: "attacker" | "target";
  refCb?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl p-1 border ${
        hl === "attacker" ? "border-emerald-400" : hl === "target" ? "border-rose-400" : "border-white/10"
      }`}
    >
      <div ref={refCb} className="relative" style={{ width: FRAME_W, height: FRAME_H }}>
        <CharacterCardFramed u={u} />
      </div>
    </button>
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
function BoardRow({
  units,
  onPick,
  pickIndex,
  pickType,
  refsArray,
}: {
  units: UnitVM[];
  onPick?: (i: number) => void;
  pickIndex?: number | null;
  pickType?: "attacker" | "target";
  refsArray?: React.MutableRefObject<(HTMLDivElement | null)[]>;
}) {
  return (
    <div className="flex justify-center gap-3 flex-wrap">
      {[0, 1, 2].map((i) => {
        const u = units[i];
        if (!u) return <EmptySlot key={`e-${i}`} />;
        const hl = pickIndex === i ? (pickType === "attacker" ? "attacker" : "target") : undefined;
        const cb = (el: HTMLDivElement | null) => {
          if (refsArray) refsArray.current[i] = el;
        };
        return <UnitCard key={`${u.code}-${i}`} u={u} onClick={() => onPick?.(i)} hl={hl} refCb={cb} />;
      })}
    </div>
  );
}

/* ===================== arrow overlay ===================== */
function ArrowOverlay({
  container,
  from,
  to,
}: {
  container: HTMLDivElement | null;
  from: HTMLDivElement | null;
  to: HTMLDivElement | null;
}) {
  if (!container || !from || !to) return null;
  const cr = container.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const fx = fr.left + fr.width / 2 - cr.left;
  const fy = fr.top + fr.height / 2 - cr.top;
  const tx = tr.left + tr.width / 2 - cr.left;
  const ty = tr.top + tr.height / 2 - cr.top;
  return (
    <svg className="pointer-events-none absolute inset-0" width={cr.width} height={cr.height}>
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L6,3 z" fill="#f87171" />
        </marker>
      </defs>
      <line x1={fx} y1={fy} x2={tx} y2={ty} stroke="#fca5a5" strokeWidth="3" markerEnd="url(#arrow)" />
    </svg>
  );
}

/* ===================== overlays ===================== */
function CoinOverlay({
  show,
  spinning,
  winner,
  you,
  onDone,
}: {
  show: boolean;
  spinning: boolean;
  winner: Side | null;
  you: Side | null;
  onDone: () => void;
}) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center">
      <div className="text-center">
        <div
          className={`w-32 h-32 rounded-full bg-gradient-to-br from-yellow-300 to-amber-600 shadow-xl grid place-items-center ${
            spinning ? "animate-[spin_1s_linear_infinite]" : ""
          }`}
        >
          <span className="font-bold text-black">COIN</span>
        </div>
        <div className="mt-4 text-lg">{spinning ? "Tossing coin…" : "Result"}</div>
        {!spinning && winner && (
          <div className="mt-2">
            <div className="text-xl font-semibold">{winner.toUpperCase()} starts!</div>
            <button onClick={onDone} className="mt-3 px-4 py-2 rounded bg-emerald-600">
              OK
            </button>
            {you && <div className="text-sm opacity-80 mt-1">{winner === you ? "คุณเริ่มก่อน" : "คู่ต่อสู้เริ่มก่อน"}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
function PhaseOverlay({ show, phase }: { show: boolean; phase: number }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center pointer-events-none">
      <div className="px-6 py-3 rounded-2xl bg-white/95 text-black text-2xl font-bold animate-[fadeout_1.8s_ease-out_forwards]">
        Phase #{phase}
      </div>
      <style jsx global>{`
        @keyframes fadeout {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          15% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-8px) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

/* ===================== PAGE ===================== */
export default function PlayRoomPage() {
  const params = useParams<{ room: string }>();
  const roomId = useMemo(() => String(params.room || "").toUpperCase(), [params.room]);

  const game = useGame(roomId);
  const { role, state, ready, endPhase, playCard, combat, discardForInfinite, ackCoin } = game;

  const cs: ClientState | null = state ?? null;

  const yourSide: Side | null = role === "host" ? "p1" : role === "player" ? "p2" : null;
  const foeSide: Side | null = yourSide === "p1" ? "p2" : yourSide === "p2" ? "p1" : null;

  const [attacker, setAttacker] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);

  // refs for arrow
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const myRefs = useRef<(HTMLDivElement | null)[]>([]);
  const foeRefs = useRef<(HTMLDivElement | null)[]>([]);

  // dice helpers
  const yourDice = (yourSide && cs?.dice?.[yourSide]) || {};
  const yourEls = useMemo(() => {
    const s = new Set<string>();
    s.add("Infinite");
    if (yourSide) for (const u of cs?.board?.[yourSide] ?? []) s.add(u.element);
    return Array.from(s);
  }, [yourSide, cs?.board]);

  const attUnit: UnitVM | null =
    yourSide != null && attacker != null ? cs?.board?.[yourSide]?.[attacker] ?? null : null;

  const haveAny = (n: number) => Object.values(yourDice).reduce((a, b) => a + (b ?? 0), 0) >= n;
  const canSpendEl = (el: string, need: number) => (yourDice[el] ?? 0) + (yourDice.Infinite ?? 0) >= need;

  const canBasic = !!attUnit && haveAny(1);
  const canSkill = !!attUnit && canSpendEl(attUnit.element, 3);
  const canUlt = !!attUnit && (attUnit.gauge ?? 0) >= 3 && canSpendEl(attUnit.element, 5);

  const onCommit = async (mode: "basic" | "skill" | "ult") => {
    if (yourSide == null || attacker == null) return;
    const foeCount = foeSide ? (cs?.board?.[foeSide]?.length ?? 0) : 0;
    if (foeCount > 0 && target == null) return;
    try {
      await combat(attacker, target, mode);
    } catch (e) {
      console.error("combat failed:", e);
      alert("โจมตีไม่สำเร็จ ดู console สำหรับรายละเอียด");
    }
    setTarget(null);
  };

  /* ---------- coin overlay (ครั้งเดียว) ---------- */
  const [coinOpen, setCoinOpen] = useState(false);
  const [coinSpin, setCoinSpin] = useState(false);
  const [coinWinner, setCoinWinner] = useState<Side | null>(null);
  const coinShownRef = useRef(false);

  useEffect(() => {
    if (!cs || cs.mode !== "play") return;
    if (!cs.coin?.decided) return;
    if (!yourSide) return;
    // รูปแบบ state ฝั่ง server ไม่มี coinAck ใน stateForClient เดิม
    // ถ้ามีให้ใช้ป้องกันการโชว์ซ้ำ แต่ถ้าไม่มี เรากันซ้ำด้วย ref
    if (coinShownRef.current) return;

    coinShownRef.current = true;
    setCoinWinner(cs.turn);
    setCoinOpen(true);
    setCoinSpin(true);
    const t = setTimeout(() => setCoinSpin(false), 1200);
    return () => clearTimeout(t);
  }, [cs?.mode, cs?.coin?.decided, cs?.turn, yourSide]);

  /* ---------- phase overlay ---------- */
  const [phaseShow, setPhaseShow] = useState(false);

  // Phase > 1 โชว์เองอัตโนมัติ
  useEffect(() => {
    if (!cs || cs.mode !== "play") return;
    if (!cs.phaseNo || cs.phaseNo <= 1) return;
    setPhaseShow(true);
    const t = setTimeout(() => setPhaseShow(false), 1800);
    return () => clearTimeout(t);
  }, [cs?.phaseNo, cs?.mode]);

  // ปิดทอยเหรียญ แล้วค่อยโชว์ Phase #1
  const onCoinDone = () => {
    setCoinOpen(false);
    ackCoin?.();
    setTimeout(() => {
      setPhaseShow(true);
      setTimeout(() => setPhaseShow(false), 1800);
    }, 300);
  };

  /* ---------- actor & banner text ---------- */
  const actor: Side | null = (cs?.phaseActor ?? cs?.turn) ?? null;
  const pInfo = cs?.players ?? {};
  const actorName = actor ? (pInfo[actor]?.name || (actor === "p1" ? "Host" : "Player")) : "-";
  const actorAvatar = actor ? (pInfo[actor]?.avatar || null) : null;

  // การกระทำ (โจมตีเท่านั้นที่เปลี่ยนเทิร์น ตามกติกาใหม่)
  const alreadyEnded = yourSide ? !!cs?.endTurned?.[yourSide] : false;
  const isYourTurn = !!(actor && yourSide && actor === yourSide);
  const lockActions = !isYourTurn || alreadyEnded;

  // field data
  const yourDiceD = (yourSide && cs?.dice?.[yourSide]) || {};
  const myUnits: UnitVM[] =
    (yourSide ? cs?.board?.[yourSide] : [])?.slice(0, 3).map((u) => ({ ...u, gauge: u.gauge ?? 0 })) ?? [];
  const foeUnits: UnitVM[] = (foeSide ? cs?.board?.[foeSide] : [])?.slice(0, 3) ?? [];

  /* ---------- render ---------- */
  return (
    <main className="min-h-screen p-6 flex flex-col gap-6">
      {/* overlays */}
      <CoinOverlay show={coinOpen} spinning={coinSpin} winner={coinWinner} you={yourSide} onDone={onCoinDone} />
      <PhaseOverlay show={phaseShow} phase={cs?.phaseNo ?? 1} />

      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Room: {roomId || "-"}</h1>
        <div className="text-sm opacity-70">You are: {role ?? "-"}</div>
      </header>

      {/* lobby */}
      {cs?.mode === "lobby" && (
        <section className="rounded-2xl border border-white/10 p-6 bg-black/20">
          <button className="px-5 py-2 rounded bg-emerald-600" onClick={() => ready()}>
            Ready
          </button>
          <p className="text-xs opacity-60 mt-2">เริ่มเกม: จั่วมือ 5 ใบ • Dice 10 • เลือกตัวเรา/เป้าหมายก่อนโจมตี</p>

          <div className="mt-4 flex gap-3">
            <div className="flex-1 rounded-lg border border-white/10 p-3">
              <div className="text-xs opacity-70 mb-1">P1</div>
              <div className="font-medium">{pInfo.p1?.name || "Host"}</div>
              <div className="mt-1 text-sm">{cs.ready?.p1 ? "✅ Ready" : "⏳ Waiting"}</div>
            </div>
            <div className="flex-1 rounded-lg border border-white/10 p-3">
              <div className="text-xs opacity-70 mb-1">P2</div>
              <div className="font-medium">{pInfo.p2?.name || "Player"}</div>
              <div className="mt-1 text-sm">{cs.ready?.p2 ? "✅ Ready" : "⏳ Waiting"}</div>
            </div>
          </div>
        </section>
      )}

      {/* play */}
      {cs?.mode === "play" && (
        <>
          {/* ARENA */}
          <div ref={arenaRef} className="relative">
            {/* opponent */}
            <section className="rounded-3xl border border-white/10 p-5 bg-black/20">
              <div className="flex items-center justify-between">
                <div className="font-semibold flex items-center gap-3">
                  <div>Phase #{cs.phaseNo ?? 1}</div>
                  <div>•</div>
                  <div className="flex items-center gap-2">
                    <span>Turn:</span>
                    {actorAvatar ? (
                      <span className="inline-flex items-center gap-2">
                        <Image src={actorAvatar} alt="avatar" width={20} height={20} className="rounded-full" />
                        <b>{actorName}</b>
                      </span>
                    ) : (
                      <b>{actorName}</b>
                    )}
                  </div>
                </div>
                <div className="text-sm opacity-70">
                  {cs.endTurned?.p1 ? "P1 ended" : "P1 active"} | {cs.endTurned?.p2 ? "P2 ended" : "P2 active"}
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-black/30 p-3">
                <div className="opacity-70 mb-1 text-sm">Opponent Board</div>
                <BoardRow
                  units={foeUnits}
                  onPick={(i) => setTarget(i)}
                  pickIndex={target}
                  pickType="target"
                  refsArray={foeRefs}
                />
              </div>
            </section>

            {/* attack arrow */}
            {attacker != null && target != null && (
              <ArrowOverlay
                container={arenaRef.current}
                from={myRefs.current[attacker] ?? null}
                to={foeRefs.current[target] ?? null}
              />
            )}
          </div>

          {/* controls */}
          <section className="rounded-2xl border border-white/10 bg-black/10 p-4 flex items-center gap-2">
            <div className="text-sm">
              Attacker: <b>{attacker != null ? `#${attacker + 1}` : "-"}</b> | Target: <b>{target != null ? `#${target + 1}` : "-"}</b>
              {attUnit && <span className="ml-2 opacity-70">({attUnit.element}, ULT {(attUnit.gauge ?? 0)}/3)</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <button
                className="px-3 py-1 rounded bg-amber-700 disabled:opacity-40"
                disabled={!canBasic || lockActions}
                onClick={() => onCommit("basic")}
              >
                Basic (1)
              </button>
              <button
                className="px-3 py-1 rounded bg-sky-700 disabled:opacity-40"
                disabled={!canSkill || lockActions}
                onClick={() => onCommit("skill")}
              >
                Skill (3)
              </button>
              <button
                className="px-3 py-1 rounded bg-violet-700 disabled:opacity-40"
                disabled={!canUlt || lockActions}
                onClick={() => onCommit("ult")}
              >
                Ultimate (5)
              </button>
              {/* End Phase ยังมีไว้เผื่อ ในกติกาปัจจุบันโจมตีเท่านั้นที่เปลี่ยนเทิร์น */}
              <button className="px-3 py-1 rounded bg-emerald-700 opacity-40 cursor-not-allowed" disabled onClick={() => endPhase()}>
                End Phase
              </button>
            </div>
          </section>

          {/* your field */}
          <section className="rounded-3xl border border-white/10 p-5 bg-black/20">
            <div className="flex items-center justify-between">
              <div className="font-medium">Your Board</div>
            </div>

            <div className="mt-4 flex justify-center">
              <BoardRow
                units={myUnits}
                onPick={(i) => {
                  setAttacker(i);
                  setTarget(null);
                }}
                pickIndex={attacker}
                pickType="attacker"
                refsArray={myRefs}
              />
            </div>

            <div className="mt-6 grid grid-cols-12 gap-4">
              {/* hand */}
              <div className="col-span-12 md:col-span-8 rounded-xl border border-white/10 bg-neutral-900/40 p-4">
                <div className="font-medium mb-2">Your Hand</div>
                <div className="flex flex-wrap gap-3">
                  {(yourSide && (cs.hand?.[yourSide]?.length ?? 0) > 0) ? (
                    cs.hand[yourSide]!.map((code, i) => (
                      <div key={`${code}-${i}`} className="flex flex-col items-center gap-1">
                        <div className="relative" style={{ width: FRAME_W, height: FRAME_H }}>
                          <CardBase code={code} />
                        </div>
                        <div className="flex gap-1">
                          <button
                            className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs disabled:opacity-40"
                            disabled={lockActions}
                            onClick={() => playCard(i)}
                          >
                            Play
                          </button>
                          <button
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs disabled:opacity-40"
                            onClick={() => discardForInfinite(i)}
                            disabled={lockActions}
                            title="Discard → ∞"
                          >
                            Discard → ∞
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm opacity-70">Empty hand</div>
                  )}
                </div>
              </div>

              {/* dice */}
              <div className="col-span-12 md:col-span-4 rounded-xl border border-white/10 bg-neutral-900/40 p-4">
                <div className="font-medium mb-2">Your Dice</div>
                <DiceTray dice={yourDiceD} priority={yourEls} />
                <div className="mt-2">
                  <DiceList dice={yourDiceD} priority={yourEls} />
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
