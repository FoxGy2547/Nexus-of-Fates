// src/app/wish/WishCinema.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";

/* ============ types ============ */
export type WishItem = {
  id: number;
  code: string;
  name?: string | null;
  art: string;
  kind: "character" | "support" | "event";
  rarity: 3 | 4 | 5;
};

type Props = {
  open: boolean;
  results: WishItem[];     // [] = waiting mode (ยังไม่รู้ผล)
  onDone: () => void;
};

/* ============ helpers ============ */
function artPath(it: WishItem): string {
  return encodeURI(it.kind === "character" ? `/char_cards/${it.art}` : `/cards/${it.art}`);
}
function highestRarity(items: WishItem[]): 3 | 4 | 5 {
  let r: 3 | 4 | 5 = 3;
  for (const it of items) { if (it.rarity === 5) return 5; if (it.rarity === 4) r = 4; }
  return r;
}

/* ============ component ============ */
const INTRO_MS = 800;            // meteor flight
const REVEAL_EACH_MS = 420;

export default function WishCinema({ open, results, onDone }: Props) {
  const hasData = results.length > 0;

  const [phase, setPhase] = useState<"intro" | "flip" | "summary">("intro");
  const [revealIndex, setRevealIndex] = useState<number>(0);
  const [skipped, setSkipped] = useState<boolean>(false);
  const [gridReady, setGridReady] = useState<boolean>(false); // กันเฟรมแรก “เฉลย”

  const maxRarity = useMemo(() => (hasData ? highestRarity(results) : 3), [hasData, results]);
  const ribbonClass = maxRarity === 5 ? "meteor--gold" : maxRarity === 4 ? "meteor--purple" : "meteor--blue";

  // รีเซ็ตทุกครั้งที่เปิด
  useEffect(() => {
    if (!open) return;
    setPhase("intro");
    setRevealIndex(0);
    setSkipped(false);
    setGridReady(false);
  }, [open]);

  // ถ้า "ยังไม่มีผล" ให้ค้างที่ intro; เมื่อผลมาถึงค่อยเริ่มจับเวลาเข้าสู่ flip
  useEffect(() => {
    if (!open) return;
    if (!hasData) return;           // รอผลก่อน
    const t = window.setTimeout(() => {
      setPhase("flip");
      // หน่วง 1 เฟรมปิดการกระพริบ (disable transition ก่อน แล้วเปิดเมื่อพร้อม)
      requestAnimationFrame(() => setGridReady(true));
    }, INTRO_MS);
    return () => window.clearTimeout(t);
  }, [open, hasData]);

  // auto reveal ทีละใบ
  useEffect(() => {
    if (phase !== "flip" || skipped) return;
    if (revealIndex >= results.length) return;
    const t = window.setTimeout(() => setRevealIndex((i) => i + 1), REVEAL_EACH_MS);
    return () => window.clearTimeout(t);
  }, [phase, revealIndex, results.length, skipped]);

  useEffect(() => {
    if (phase === "flip" && revealIndex >= results.length) setPhase("summary");
  }, [phase, revealIndex, results.length]);

  function onSkipAll() {
    setSkipped(true);
    setRevealIndex(results.length);
    setPhase("summary");
  }
  function onFlipOne(idx: number) {
    if (phase !== "flip") return;
    if (idx > revealIndex) return;
    if (idx === revealIndex) setRevealIndex(idx + 1);
  }

  if (!open) return null;

  return (
    <div className="wish-overlay">
      {/* top-right */}
      <div className="wish-topbar">
        {phase !== "summary" ? (
          <button className="btn-skip" onClick={onSkipAll}>Skip</button>
        ) : (
          <button className="btn-skip" onClick={onDone}>Close</button>
        )}
      </div>

      {/* INTRO */}
      {phase === "intro" && (
        <>
          <div className={`meteor ${ribbonClass}`}>
            <div className="meteor__core" />
            <div className="meteor__tail meteor__tail--1" />
            <div className="meteor__tail meteor__tail--2" />
            <div className="meteor__tail meteor__tail--3" />
            <div className="meteor__spark meteor__spark--1" />
            <div className="meteor__spark meteor__spark--2" />
            <div className="meteor__spark meteor__spark--3" />
          </div>

          {/* ข้อความรอกลางจอ (เฉพาะตอนยังไม่มีผล) */}
          {!hasData && (
            <div className="wait-center" role="status" aria-live="polite">
              <div className="spinner" />
              <div className="wait-lines">
                <div className="wait-title">Just a moment</div>
                <div className="wait-sub">รอแปปนึงเน้อ</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* FLIP */}
      {(phase === "flip" || phase === "summary") && hasData && (
        <div className={`flip-grid columns-${results.length === 10 ? "ten" : "one"} ${gridReady ? "" : "pre"}`}>
          {results.map((it, idx) => {
            const revealed = idx < revealIndex || phase === "summary";
            const cls =
              it.rarity === 5 ? "is-five" : it.rarity === 4 ? "is-four" : "is-three";
            return (
              <button
                key={`${it.kind}-${it.id}-${idx}`}
                className={`flip-card ${cls} ${revealed ? "is-revealed" : ""}`}
                onClick={() => onFlipOne(idx)}
                aria-label={revealed ? (it.name || it.code) : "Reveal"}
              >
                {/* back */}
                <div className="flip-face flip-back">
                  <div className="back-inner">
                    <div className="back-glow" />
                    <div className="back-star" />
                  </div>
                </div>

                {/* front */}
                <div className="flip-face flip-front">
                  <div className="front-border" />
                  <div className="front-img">
                    <Image
                      src={artPath(it)}
                      alt={it.name || it.code}
                      fill
                      sizes="(max-width: 768px) 40vw, 260px"
                      className="obj-contain"
                      unoptimized
                      priority={results.length <= 2}
                    />
                  </div>
                  <div className="front-caption">
                    <span className="front-name">{it.name || it.code.replaceAll("_", " ")}</span>
                    <span className="front-stars">
                      {it.rarity === 5 ? "★★★★★" : it.rarity === 4 ? "★★★★" : "★★★"}
                    </span>
                  </div>
                  {it.rarity === 5 && <div className="shine" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* SUMMARY */}
      {phase === "summary" && (
        <button className="to-continue" onClick={onDone}>Click anywhere to continue</button>
      )}

      {/* ========== styles ========== */}
      <style jsx>{`
        .wish-overlay{position:fixed;inset:0;z-index:60;background:radial-gradient(1200px 600px at 50% 30%,rgba(35,52,90,.8),rgba(6,10,18,.96) 55%);display:flex;align-items:center;justify-content:center;overflow:hidden;user-select:none;backdrop-filter: blur(7px);}
        .wish-topbar{position:absolute;top:14px;right:14px;z-index:70}
        .btn-skip{padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;font-weight:600}

        /* wait text */
        .wait-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:68;pointer-events:none}
        .spinner{width:22px;height:22px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:999px;animation:spin .9s linear infinite}
        .wait-lines{display:flex;flex-direction:column;align-items:center;gap:4px}
        .wait-title{color:#fff;font-weight:700;font-size:18px;text-shadow:0 2px 6px rgba(0,0,0,.5)}
        .wait-sub{color:#fff;font-weight:600;opacity:.9;text-shadow:0 2px 6px rgba(0,0,0,.5)}

        /* meteor */
        .meteor{position:absolute;inset:0;overflow:hidden}
        .meteor__core{position:absolute;left:-20%;top:-20%;width:24px;height:24px;border-radius:999px;background:#fff;filter:blur(1px);animation:meteorMove ${INTRO_MS}ms ease-in forwards}
        .meteor__tail{position:absolute;left:-25%;top:-25%;width:50%;height:4px;border-radius:4px;opacity:.85;filter:blur(1px);animation:meteorMove ${INTRO_MS}ms ease-in forwards}
        .meteor__tail--1{transform:rotate(22deg) translateZ(0)}
        .meteor__tail--2{top:-23%;height:2px;opacity:.6;transform:rotate(21deg) translateZ(0)}
        .meteor__tail--3{top:-27%;height:6px;opacity:.3;filter:blur(2px);transform:rotate(23deg) translateZ(0)}
        .meteor__spark{position:absolute;left:-20%;top:-20%;width:8px;height:8px;border-radius:8px;background:currentColor;opacity:.8;filter:blur(1px);animation:meteorSpark ${INTRO_MS}ms ease-in forwards}
        .meteor--blue{color:#57a9ff}.meteor--purple{color:#a060ff}.meteor--gold{color:#f5c542}

        /* grid */
        .flip-grid{position:relative;width:min(1180px,94vw);margin:0 auto;display:grid;gap:16px;z-index:65}
        .flip-grid.columns-ten{grid-template-columns:repeat(5,minmax(0,1fr))}
        .flip-grid.columns-one{grid-template-columns:repeat(1,minmax(0,1fr));width:min(360px,80vw)}
        /* ป้องกันเฟรมแรกที่ front โผล่ */
        .flip-grid.pre .flip-face{transition:none!important}
        .flip-grid.pre .flip-front{opacity:0}

        .flip-card{position:relative;aspect-ratio:2/3;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.3);perspective:900px;cursor:pointer}
        .flip-card.is-three{box-shadow:0 0 0 1px rgba(87,169,255,.25) inset}
        .flip-card.is-four{box-shadow:0 0 0 1px rgba(160,96,255,.28) inset}
        .flip-card.is-five{box-shadow:0 0 0 1px rgba(245,197,66,.36) inset}

        .flip-face{position:absolute;inset:0;backface-visibility:hidden;transform-style:preserve-3d;transition:transform 520ms ease, opacity 220ms ease;will-change:transform,opacity}
        .flip-back{display:grid;place-items:center;background:radial-gradient(600px 300px at 50% 40%,rgba(255,255,255,.06),rgba(0,0,0,.2))}
        .back-inner{position:relative;width:60%;height:60%;border-radius:14px;border:1px dashed rgba(255,255,255,.25)}
        .back-glow{position:absolute;inset:-20% -20% auto -20%;height:60%;background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.25) 50%,rgba(255,255,255,0) 100%);transform:rotate(28deg);filter:blur(6px)}
        .back-star{position:absolute;left:50%;top:50%;width:28px;height:28px;transform:translate(-50%,-50%) rotate(45deg);box-shadow:0 -8px 0 0 currentColor,0 8px 0 0 currentColor,-8px 0 0 0 currentColor,8px 0 0 0 currentColor;opacity:.45}

        .flip-front{transform:rotateY(180deg);display:grid;grid-template-rows:1fr auto;align-items:end;opacity:0} /* ซ่อน front เป็นพื้นฐาน */
        .front-border{position:absolute;inset:0;border-radius:14px;pointer-events:none;border:2px solid rgba(255,255,255,.08)}
        .front-img{position:absolute;inset:8px 8px 46px 8px}
        .obj-contain{object-fit:contain}
        .front-caption{position:absolute;left:0;right:0;bottom:6px;padding:0 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;text-shadow:0 1px 2px rgba(0,0,0,.6)}
        .front-name{font-weight:600;color:#fff;max-width:72%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
        .front-stars{color:#f5c542;opacity:.9;letter-spacing:2px;font-size:13px}

        .flip-card.is-revealed .flip-back{transform:rotateY(180deg)}
        .flip-card.is-revealed .flip-front{transform:rotateY(360deg);opacity:1}

        .flip-card.is-five .shine{position:absolute;inset:0;pointer-events:none;background:radial-gradient(600px 220px at 50% 10%,rgba(255,230,150,.2),rgba(255,230,150,0) 60%),radial-gradient(300px 180px at 20% 80%,rgba(255,210,120,.16),rgba(0,0,0,0) 70%),radial-gradient(300px 180px at 80% 80%,rgba(255,210,120,.16),rgba(0,0,0,0) 70%);mix-blend-mode:screen;animation:shinePulse 1200ms ease-in-out 1 forwards}

        .to-continue{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:10px 14px;border-radius:999px;color:#fff;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.15);text-shadow:0 1px 1px rgba(0,0,0,.45);animation:fadeUp 600ms ease forwards}
      `}</style>

      <style jsx global>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes meteorMove{from{transform:translate3d(-20%,-20%,0) rotate(22deg);opacity:0}35%{opacity:1}to{transform:translate3d(120%,120%,0) rotate(22deg);opacity:0}}
        @keyframes meteorSpark{from{transform:translate3d(-22%,-22%,0) rotate(22deg);opacity:0}30%{opacity:1}to{transform:translate3d(110%,110%,0) rotate(22deg);opacity:0}}
        @keyframes shinePulse{0%{opacity:0}30%{opacity:1}100%{opacity:.88}}
        @keyframes fadeUp{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
      `}</style>
    </div>
  );
}
