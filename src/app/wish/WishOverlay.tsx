// src/app/wish/WishOverlay.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

/** ประเภทข้อมูลที่ API ส่งกลับมา */
export type WishResult =
  | {
      stars: 5 | 4;
      kind: "character" | "support" | "event";
      id: number;
      code: string;
      name: string;
      art: string;
    }
  | {
      stars: 3;
      kind: "filler";
      id: 0;
      code: "COMMON";
      name: "Common Reward";
      art: "";
    };

/** ช่วยสร้าง url รูป (ใช้พาธเดียวกับ deck-builder) */
function cardImg(art: string, kind: "character" | "support" | "event"): string {
  return encodeURI(kind === "character" ? `/char_cards/${art}` : `/cards/${art}`);
}

function rarityColor(stars: 3 | 4 | 5) {
  if (stars === 5) return "#f6c14a"; // ทอง
  if (stars === 4) return "#a68cff"; // ม่วง
  return "#69c0ff"; // ฟ้า
}

/** Meteor intro สีตามเรทสูงสุด */
function MeteorIntro({ topStars, onDone }: { topStars: 3 | 4 | 5; onDone: () => void }) {
  const color = rarityColor(topStars);
  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onAnimationComplete={() => {
        // รอช่วงเมเทียร์วิ่งสักหน่อยค่อยปล่อยต่อ
        setTimeout(onDone, 1100);
      }}
    >
      {/* ท้องฟ้า */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a1220] to-[#080a12]" />

      {/* เส้นทางอุกกาบาต */}
      <motion.div
        initial={{ x: "-120%", y: "-20%", rotate: -12, scale: 0.9 }}
        animate={{ x: "140%", y: "20%", rotate: -12, scale: 1 }}
        transition={{ duration: 1.0, ease: "easeOut" }}
        className="h-1 w-[120%] rounded-full blur-sm"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          boxShadow: `0 0 16px ${color}`,
        }}
      />

      {/* วงแหวนแตกคลื่น */}
      <motion.div
        className="absolute w-[420px] h-[420px] rounded-full"
        initial={{ scale: 0, opacity: 0.6 }}
        animate={{ scale: [0, 1.2, 1.7], opacity: [0.8, 0.4, 0] }}
        transition={{ duration: 1.0, ease: "easeOut" }}
        style={{ border: `4px solid ${color}`, boxShadow: `0 0 48px ${color}` }}
      />
    </motion.div>
  );
}

/** การ์ดแบบพลิกหน้า (โป๊กเกอร์) */
function FlipCard({
  result,
  index,
  reveal,
  onFlipped,
}: {
  result: WishResult;
  index: number;
  reveal: boolean;
  onFlipped?: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const canFlip = reveal && !flipped;

  useEffect(() => {
    if (reveal && !flipped) {
      // auto flip แบบต่อเนื่องเล็กน้อย
      const t = setTimeout(() => setFlipped(true), 80 + index * 120);
      return () => clearTimeout(t);
    }
  }, [reveal, flipped, index]);

  useEffect(() => {
    if (flipped && onFlipped) {
      const t = setTimeout(onFlipped, 180);
      return () => clearTimeout(t);
    }
  }, [flipped, onFlipped]);

  const front = (
    <div className="absolute inset-0 bg-[#0e1422] rounded-xl border border-white/10 flex items-center justify-center">
      <div className="text-xs opacity-70">CARD {index + 1}</div>
    </div>
  );

  const back =
    result.stars === 3 ? (
      <div
        className="absolute inset-0 rounded-xl flex items-center justify-center text-white/80"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 40%, rgba(105,192,255,0.35), rgba(0,0,0,0.0)), #0e1422",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="text-center">
          <div className="text-sm">Common Reward</div>
          <div className="text-[11px] opacity-70 mt-1">★★★</div>
        </div>
      </div>
    ) : (
      <div
        className="absolute inset-0 rounded-xl overflow-hidden flex flex-col"
        style={{
          border: "1px solid rgba(255,255,255,0.1)",
          background:
            "radial-gradient(60% 60% at 50% 35%, rgba(255,255,255,0.06), rgba(0,0,0,0))",
        }}
      >
        <div className="relative flex-1">
          <Image
            src={cardImg(result.art, result.kind === "character" ? "character" : result.kind)}
            alt={result.code}
            fill
            className="object-contain"
            unoptimized
          />
        </div>
        <div className="p-2">
          <div className="text-[12px] font-medium truncate">{result.name}</div>
          <div className="text-[11px]" style={{ color: rarityColor(result.stars) }}>
            {"★".repeat(result.stars)}
          </div>
        </div>
      </div>
    );

  return (
    <motion.div
      className="relative w-[164px] h-[232px] [perspective:1000px]"
      onClick={() => canFlip && setFlipped(true)}
    >
      <motion.div
        className="absolute inset-0 [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.45, ease: "easeInOut" }}
      >
        <div className="absolute inset-0 [backface-visibility:hidden]">{front}</div>
        <div className="absolute inset-0 [transform:rotateY(180deg)] [backface-visibility:hidden]">
          {back}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** ฉากโชว์ผลทั้งหมด: meteor → flip ทีละใบ → สรุป */
export default function WishOverlay({
  results,
  onClose,
}: {
  results: WishResult[];
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"meteor" | "flip" | "summary">("meteor");
  const [reveal, setReveal] = useState(false);
  const [flipped, setFlipped] = useState(0);

  const topStars = useMemo<3 | 4 | 5>(() => (results.some((r) => r.stars === 5) ? 5 : results.some((r) => r.stars === 4) ? 4 : 3), [results]);

  useEffect(() => {
    if (phase === "flip") {
      // เริ่มเปิดไพ่
      const t = setTimeout(() => setReveal(true), 150);
      return () => clearTimeout(t);
    }
  }, [phase]);

  useEffect(() => {
    if (phase === "flip" && flipped >= results.length) {
      const t = setTimeout(() => setPhase("summary"), 250);
      return () => clearTimeout(t);
    }
  }, [flipped, results.length, phase]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* meteor */}
        <AnimatePresence>
          {phase === "meteor" && (
            <MeteorIntro
              topStars={topStars}
              onDone={() => {
                setPhase("flip");
              }}
            />
          )}
        </AnimatePresence>

        {/* พื้นหลังหลัก */}
        <div className="absolute inset-0 flex flex-col items-center pt-10">
          {/* แถบหัว */}
          <div className="mb-4 text-sm text-white/70">
            Tap cards to flip • {results.length} item{results.length > 1 ? "s" : ""}
          </div>

          {/* กริดการ์ด */}
          <div className="grid grid-cols-5 gap-4">
            {results.map((r, i) => (
              <FlipCard
                key={i}
                result={r}
                index={i}
                reveal={reveal}
                onFlipped={() => setFlipped((n) => n + 1)}
              />
            ))}
          </div>

          {/* ปุ่มปิดเมื่อจบ */}
          {phase === "summary" && (
            <button
              className="mt-8 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
