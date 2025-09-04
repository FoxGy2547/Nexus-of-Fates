"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { useGame, CARD_IMG, Side, PlayersMsg, BattleState } from "@/hooks/useGame";

function useRoomParam(): string {
  const p = useParams<{ room: string }>();
  return useMemo(() => (Array.isArray(p.room) ? p.room[0] : p.room) ?? "", [p.room]);
}

export default function PlayRoomPage() {
  const roomId = useRoomParam();
  const { you, players, state, endTurn, playCard, attackActive, switchActive } = useGame(roomId);

  return (
    <main className="min-h-screen p-4 md:p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Room: {roomId}</h1>
        <div className="text-sm opacity-70">You are: {you || "-"}</div>
      </header>

      <PlayersPanel players={players} you={you} />

      <section className="grid md:grid-cols-2 gap-6">
        <Board title="Opponent Board" side="p2" state={state} />
        <Board title="Your Board" side="p1" state={state} />
      </section>

      <HandPanel
        state={state}
        you={you}
        onPlay={(i) => playCard(i)}
        onSwitch={(i) => switchActive(i)}
        onAttack={() => attackActive()}
        onEndTurn={() => endTurn()}
      />
    </main>
  );
}

/* ---------- UI subcomponents ---------- */
function PlayersPanel({ players, you }: { players: PlayersMsg; you: Side | "" }) {
  const p1 = players.p1;
  const p2 = players.p2;
  return (
    <section className="grid grid-cols-2 gap-4">
      <PlayerCard label="P1" player={p1} highlight={you === "p1"} />
      <PlayerCard label="P2" player={p2} highlight={you === "p2"} />
    </section>
  );
}

function PlayerCard({
  label,
  player,
  highlight,
}: {
  label: string;
  player: PlayersMsg["p1"];
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-white/10 p-3 bg-black/20 ${
        highlight ? "ring-2 ring-emerald-500" : ""
      }`}
    >
      {player?.avatar ? (
        <Image
          src={player.avatar}
          alt={player?.name ? `${player.name} avatar` : ""}
          width={36}
          height={36}
          className="rounded-full"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-white/10" aria-hidden />
      )}
      <div className="flex flex-col">
        <div className="text-xs opacity-60">{label}</div>
        <div className="text-sm">{player?.name ?? "—"}</div>
      </div>
    </div>
  );
}

function Board({
  title,
  side,
  state,
}: {
  title: string;
  side: Side;
  state: BattleState | null;
}) {
  const units = state?.chars?.[side] ?? [];
  return (
    <div className="rounded-xl border border-white/10 p-3 bg-black/10">
      <div className="font-medium mb-2">{title}</div>
      <div className="grid grid-cols-3 gap-3">
        {units.map((u) => (
          <CardSlot key={u.code} code={u.code} hp={u.hp} atk={u.attack} />
        ))}
        {units.length === 0 && (
          <div className="col-span-3 text-center text-sm opacity-60">No units</div>
        )}
      </div>
    </div>
  );
}

function CardSlot({ code, hp, atk }: { code: string; hp: number; atk: number }) {
  const img = CARD_IMG[code];
  return (
    <div className="relative rounded-lg overflow-hidden bg-white/5 aspect-[4/5]">
      {img ? (
        <Image
          src={`/cards/${img}`}
          alt={code}
          fill
          sizes="(max-width: 768px) 50vw, 25vw"
          className="object-cover"
        />
      ) : (
        <div className="w-full h-full grid place-items-center text-xs opacity-60">{code}</div>
      )}
      <div className="absolute bottom-1 left-1 text-xs bg-black/70 px-1.5 py-0.5 rounded">
        ATK {atk}
      </div>
      <div className="absolute bottom-1 right-1 text-xs bg-black/70 px-1.5 py-0.5 rounded">
        HP {hp}
      </div>
    </div>
  );
}

function HandPanel({
  state,
  you,
  onPlay,
  onSwitch,
  onAttack,
  onEndTurn,
}: {
  state: BattleState | null;
  you: Side | "";
  onPlay: (index: number) => void;
  onSwitch: (index: number) => void;
  onAttack: () => void;
  onEndTurn: () => void;
}) {
  const myHand = you ? state?.hand?.[you] ?? [] : [];
  const myTurn = you ? state?.turn === you : false;

  return (
    <section className="rounded-xl border border-white/10 p-3 bg-black/20">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium">Your Hand</div>
        <div className={`text-sm ${myTurn ? "text-emerald-400" : "opacity-60"}`}>
          {myTurn ? "Your turn" : "Waiting..."}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {myHand.map((code, idx) => (
          <button
            key={`${code}-${idx}`}
            className="px-2 py-1 rounded bg-sky-700/70 hover:bg-sky-700 text-xs"
            onClick={() => onPlay(idx)}
          >
            Play {code}
          </button>
        ))}
        {myHand.length === 0 && <div className="text-sm opacity-60">Empty hand</div>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="px-3 py-1.5 rounded bg-amber-700/70 hover:bg-amber-700 text-sm" onClick={onAttack}>
          Attack
        </button>
        <button className="px-3 py-1.5 rounded bg-rose-700/70 hover:bg-rose-700 text-sm" onClick={onEndTurn}>
          End Turn
        </button>
        <button className="px-3 py-1.5 rounded bg-teal-700/70 hover:bg-teal-700 text-sm" onClick={() => onSwitch(0)}>
          Switch 0
        </button>
        <button className="px-3 py-1.5 rounded bg-teal-700/70 hover:bg-teal-700 text-sm" onClick={() => onSwitch(1)}>
          Switch 1
        </button>
      </div>
    </section>
  );
}
