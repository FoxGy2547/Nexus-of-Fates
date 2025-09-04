// web/src/app/play/[room]/page.tsx
"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

/* ========= types ========= */
type Side = "p1" | "p2";
type Element =
    | "Pyro" | "Hydro" | "Cryo" | "Electro"
    | "Geo" | "Anemo" | "Quantum" | "Imaginary" | "Neutral";

type DicePool = Record<Element, number>;

type PlayerInfo = {
    userId: string;
    name?: string | null;
    avatar?: string | null;
};

type Players = { p1: PlayerInfo | null; p2: PlayerInfo | null };

type Unit = { code: string; atk: number; hp: number; element: Element };

type BattleState = {
    phase?: "lobby" | "play";
    rngSeed?: string;
    turn?: Side;
    lastAction?: any;
    // minimal fieldsพอให้ UI ไม่พัง
    hero?: { p1: number; p2: number };
    board?: { p1: Unit[]; p2: Unit[] };
    hand?: { p1: string[]; p2: string[] };
    dice?: { p1: DicePool; p2: DicePool };
};

type JoinRes =
    | { ok: true; you: Side; roomId: string; players: Players; state: BattleState }
    | { ok: false; error: string };

type PlayersRes = { ok: true; players: Players };

type StateRes =
    | { ok: true; full: boolean; state: BattleState }
    | { ok: true; full: false; patch: Partial<BattleState> };

type ActionRes =
    | { ok: true; patch?: Partial<BattleState>; winner?: Side | null }
    | { ok: false; error: string };

/* ========= helpers ========= */
const EMPTY_DICE: DicePool = {
    Pyro: 0, Hydro: 0, Cryo: 0, Electro: 0, Geo: 0, Anemo: 0, Quantum: 0, Imaginary: 0, Neutral: 0,
};

function mergeState(prev: BattleState | null, incoming: Partial<BattleState>): BattleState {
    const base: BattleState = prev ?? {
        phase: "lobby",
        turn: "p1",
        hero: { p1: 30, p2: 30 },
        board: { p1: [], p2: [] },
        hand: { p1: [], p2: [] },
        dice: { p1: { ...EMPTY_DICE }, p2: { ...EMPTY_DICE } },
    };
    return {
        ...base,
        ...incoming,
        hero: { ...(base.hero ?? { p1: 30, p2: 30 }), ...(incoming.hero ?? {}) },
        board: {
            p1: incoming.board?.p1 ?? base.board!.p1,
            p2: incoming.board?.p2 ?? base.board!.p2,
        },
        hand: {
            p1: incoming.hand?.p1 ?? base.hand!.p1,
            p2: incoming.hand?.p2 ?? base.hand!.p2,
        },
        dice: {
            p1: { ...(base.dice?.p1 ?? EMPTY_DICE), ...(incoming.dice?.p1 ?? {}) },
            p2: { ...(base.dice?.p2 ?? EMPTY_DICE), ...(incoming.dice?.p2 ?? {}) },
        },
    };
}

async function post<T>(body: any): Promise<T> {
    const res = await fetch("/api/game", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    // ถ้าเซิร์ฟเวอร์ล้ม res.ok = false → จะโยนข้อความให้อ่านง่าย
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} /api/game → ${txt || "Failed"}`);
    }
    return res.json();
}

/* ========= page ========= */
export default function PlayRoomPage({ params }: { params: Promise<{ room: string }> }) {
    const { room } = use(params);
    const { data: session, status } = useSession();

    // ฝั่งเราอยู่ซ้าย, ศัตรูขวา
    const [you, setYou] = useState<Side>("p1");
    const [players, setPlayers] = useState<Players>({ p1: null, p2: null });
    const [state, setState] = useState<BattleState | null>(null);

    const joined = useRef(false);

    const meInfo = useMemo(
        () => ({
            userId: (session?.user as any)?.id ?? (session?.user?.email ?? "guest"),
            name: session?.user?.name ?? "Discord User",
            avatar: session?.user?.image ?? undefined,
        }),
        [session]
    );

    /* ---------- join room (once per user/room) ---------- */
    useEffect(() => {
        if (status !== "authenticated") return;
        if (!meInfo.userId) return;
        if (joined.current) return;

        let stop = false;
        (async () => {
            try {
                const r = await post<JoinRes>({
                    action: "joinRoom",
                    roomId: room,
                    user: meInfo,
                });
                if (!r.ok) throw new Error((r as any).error);
                if (stop) return;

                setYou(r.you);
                setPlayers(r.players);
                setState(r.state);
                joined.current = true;
            } catch (e: any) {
                alert(`Join failed: ${e?.message || e}`);
            }
        })();

        return () => {
            stop = true;
        };
    }, [room, status, meInfo.userId]); // ชัด ๆ ไม่ใส่ joinedRef.current ใน deps

    /* ---------- poll players ---------- */
    useEffect(() => {
        if (!joined.current) return;
        let alive = true;

        const iv = setInterval(async () => {
            try {
                const r = await post<PlayersRes>({ action: "players", roomId: room });
                if (!alive) return;
                if (r?.ok && r.players) setPlayers(r.players);
            } catch {
                // มักเกิดตอน dev serverล้ม → ปล่อยเงียบไว้
            }
        }, 1000);

        return () => {
            alive = false;
            clearInterval(iv);
        };
    }, [room, joined.current]);

    /* ---------- poll state/patch ---------- */
    useEffect(() => {
        if (!joined.current) return;
        let alive = true;

        const iv = setInterval(async () => {
            try {
                const r = await post<StateRes>({ action: "state", roomId: room });
                if (!alive) return;
                if (r.ok) {
                    if ("full" in r && r.full) {
                        setState(r.state);
                    } else if ("patch" in r) {
                        setState((prev) => mergeState(prev, r.patch || {}));
                    }
                }
            } catch {
                // ปล่อยว่าง
            }
        }, 900);

        return () => {
            alive = false;
            clearInterval(iv);
        };
    }, [room, joined.current]);

    /* ---------- actions ---------- */
    async function gameAction(payload: any) {
        const r = await post<ActionRes>({
            action: "action",
            roomId: room,
            side: you,
            payload,
        });

        if (!r.ok) throw new Error(r.error);

        // ✅ จับไว้ในตัวแปร เพื่อให้ TS แคบ type ได้ใน closure
        const patch = r.patch;
        if (patch) {
            setState((prev) => mergeState(prev, patch));
        }

        if (r.winner) alert(`Winner: ${r.winner}`);
    }

    const endTurn = () => gameAction({ kind: "endTurn" }).catch((e) => alert(e.message));
    // ให้ “โจมตี” ใช้ kind ที่ API รองรับ = "attack"
    const attack = () => gameAction({ kind: "attack", index: 0 }).catch((e) => alert(e.message));

    /* ---------- render ---------- */
    const foe: Side = you === "p1" ? "p2" : "p1";

    const meName = players[you]?.name ?? "You";
    const meAvatar = players[you]?.avatar;
    const foeName = players[foe]?.name ?? "Waiting…";
    const foeAvatar = players[foe]?.avatar;

    return (
        <main className="p-6 text-sm">
            {/* Header: เราซ้าย ศัตรูขวา */}
            <header className="grid grid-cols-[1fr_auto_1fr] items-center mb-3 gap-4">
                <div className="flex items-center gap-3">
                    {meAvatar ? (
                        <img src={meAvatar} className="w-8 h-8 rounded-full" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-white/10 grid place-items-center">N</div>
                    )}
                    <span className="font-semibold truncate">{meName}</span>
                </div>

                <div className="text-center">
                    <span className="font-semibold">Room {room}</span>
                    <span className="mx-2">•</span>
                    <span>
                        Turn:{" "}
                        <span className="text-purple-300">{state?.turn ?? "-"}</span>
                    </span>
                </div>

                <div className="flex items-center gap-3 justify-end">
                    <span className="font-semibold truncate">{foeName}</span>
                    {foeAvatar ? (
                        <img src={foeAvatar} className="w-8 h-8 rounded-full" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-white/10 grid place-items-center">N</div>
                    )}
                </div>
            </header>

            <div className="mb-3 opacity-70">
                Last Action: {state?.lastAction ? JSON.stringify(state.lastAction) : "-"}
            </div>

            {/* บอร์ดเรียง: เราซ้าย ศัตรูขวา */}
            <section className="grid grid-cols-2 gap-8">
                {/* my side */}
                <div>
                    <div className="w-40 h-52 rounded-xl border border-white/10 bg-black/20 grid place-items-center">
                        -
                    </div>
                    {/* dice */}
                    <div className="mt-3 grid grid-cols-2 gap-1 text-xs">
                        {Object.entries(state?.dice?.[you] ?? EMPTY_DICE).map(([k, v]) => (
                            <div key={`m-${k}`}>{k}:{String(v)}</div>
                        ))}
                    </div>
                </div>

                {/* foe side */}
                <div className="justify-self-end">
                    <div className="w-40 h-52 rounded-xl border border-white/10 bg-black/20 grid place-items-center">
                        -
                    </div>
                    {/* dice */}
                    <div className="mt-3 grid grid-cols-2 gap-1 text-xs">
                        {Object.entries(state?.dice?.[foe] ?? EMPTY_DICE).map(([k, v]) => (
                            <div key={`f-${k}`}>{k}:{String(v)}</div>
                        ))}
                    </div>
                </div>
            </section>

            {/* controls */}
            <div className="mt-6 flex gap-2">
                <button
                    className="px-3 py-2 rounded bg-fuchsia-600/70 hover:bg-fuchsia-600"
                    onClick={attack}
                >
                    โจมตี Active ของศัตรู
                </button>
                <button
                    className="px-3 py-2 rounded bg-blue-600/70 hover:bg-blue-600"
                    onClick={endTurn}
                >
                    End Turn
                </button>
            </div>

            {/* hand (placeholder) */}
            <section className="mt-6">
                <div className="mb-2 font-semibold">Your Hand</div>
                <div className="text-white/60">ไม่มีการ์ดในมือ</div>
            </section>
        </main>
    );
}
