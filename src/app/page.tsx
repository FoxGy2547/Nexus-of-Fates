"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import Image from "next/image";

/* ================= helpers ================= */

/** POST ไป /api/game พร้อมจัดการ error message ให้อ่านง่าย */
async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });

  const rawText = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    /* ignore parse error */
  }

  if (!res.ok) {
    const msg =
      ((json as { error?: string } | null)?.error) ??
      (rawText || res.statusText || "Request failed");
    throw new Error(msg);
  }
  return (json as T) ?? ({} as T);
}

/** สุ่มไอดีแบบ type-safe (ถ้ามี crypto.randomUUID ก็ใช้ ไม่งั้น fallback) */
function safeRandomId(): string {
  if (typeof globalThis !== "undefined" && "crypto" in globalThis) {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID();
    }
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** userId เสถียรทั้งแอป (auth > email > guestId); การันตีคืนค่า string เสมอ */
function stableUserId(session: Session | null | undefined): string {
  if (typeof window === "undefined") return "ssr";

  const authId =
    (session?.user as { id?: string | null } | undefined)?.id ??
    session?.user?.email ??
    null;
  if (authId) return String(authId);

  const key = "NOF_guestId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const rnd = safeRandomId();
  localStorage.setItem(key, rnd);
  return rnd;
}

function randRoom(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/* ================= types ================= */
type CreateJoinResponse = { ok: boolean; roomId?: string };
type PlayerInfo = {
  userId: string;
  name?: string | null;
  avatar?: string | null;
};

/* ================= page ================= */
export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [createCode, setCreateCode] = useState<string>(randRoom());
  const [joinCode, setJoinCode] = useState<string>("");

  // user id ที่ใช้กับ Deck Builder (เป็น id จากตาราง users ใน DB)
  // ใส่ค่าเริ่มต้นเป็น 6 ตามข้อมูลที่มีตอนนี้ (2,4,6)
  const [invUserId, setInvUserId] = useState<number>(6);

  const user: PlayerInfo = useMemo(() => {
    const id = stableUserId(session);
    return {
      userId: id,
      name: session?.user?.name ?? "Player",
      avatar: session?.user?.image ?? null,
    };
  }, [session]);

  async function onCreate() {
    try {
      const roomId = (createCode || randRoom()).toUpperCase();
      const res = await post<CreateJoinResponse>({
        action: "createRoom",
        roomId,
        user,
      });
      router.push(`/play/${(res.roomId || roomId).toUpperCase()}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      alert(`Create failed: ${msg}`);
    }
  }

  async function onJoin() {
    try {
      const roomId = (joinCode || "").trim().toUpperCase();
      if (!roomId) {
        alert("กรอกรหัสห้องก่อนนะ");
        return;
      }
      const res = await post<CreateJoinResponse>({
        action: "joinRoom",
        roomId,
        user,
      });
      router.push(`/play/${(res.roomId || roomId).toUpperCase()}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      alert(`Join failed: ${msg}`);
    }
  }

  return (
    <main className="min-h-screen p-6 flex flex-col gap-8">
      <h1 className="text-2xl font-bold">Nexus of Fates</h1>

      {/* auth */}
      <section className="flex items-center gap-3">
        {status === "authenticated" ? (
          <>
            {session?.user?.image && (
              <Image
                src={session.user.image}
                alt={session.user?.name ? `${session.user.name} avatar` : ""}
                width={32}
                height={32}
                className="rounded-full"
              />
            )}
            <span>{session?.user?.name ?? "Discord User"}</span>
            <button
              className="px-3 py-1 rounded bg-red-600"
              onClick={() => signOut()}
            >
              Logout
            </button>
          </>
        ) : (
          <button
            className="px-3 py-1 rounded bg-indigo-600"
            onClick={() => signIn("discord")}
          >
            Login with Discord
          </button>
        )}
      </section>

      {/* create / join */}
      <section className="grid md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-white/10 p-4 bg-black/20">
          <div className="font-semibold mb-2">สร้างห้อง (Host)</div>
          <div className="flex gap-2">
            <input
              className="px-3 py-2 rounded bg-neutral-800 flex-1"
              placeholder="ROOM CODE (เว้นว่างให้สุ่มได้)"
              value={createCode}
              onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
            />
            <button className="px-4 py-2 rounded bg-emerald-600" onClick={onCreate}>
              Create
            </button>
          </div>
          <p className="mt-2 text-xs opacity-70">
            โฮสต์จะถูกกำหนดเป็นฝั่ง p1 โดยอัตโนมัติ
          </p>
        </div>

        <div className="rounded-xl border border-white/10 p-4 bg-black/20">
          <div className="font-semibold mb-2">เข้าห้องด้วยรหัส</div>
          <div className="flex gap-2">
            <input
              className="px-3 py-2 rounded bg-neutral-800 flex-1"
              placeholder="เช่น ABC123"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button
              className="px-4 py-2 rounded bg-sky-600"
              onClick={onJoin}
              disabled={!joinCode.trim()}
            >
              Join
            </button>
          </div>
        </div>
      </section>

      {/* deck builder entry */}
      <section className="rounded-xl border border-white/10 p-4 bg-black/20">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-semibold">Deck Builder</div>
          <span className="text-sm opacity-70">
            จัดเด็ค: เลือกตัวละคร ≤ 3 ใบ และการ์ดเสริม/อีเวนต์รวม ≤ 20 ใบ
          </span>

          {/* เลือก user id (inventory owner) แบบมินิมอล */}
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm opacity-80">Inventory user:</label>
            <div className="inline-flex rounded-lg overflow-hidden border border-white/10">
              {[2, 4, 6].map((id) => (
                <button
                  key={id}
                  onClick={() => setInvUserId(id)}
                  className={[
                    "px-3 py-1.5 text-sm",
                    invUserId === id ? "bg-purple-600" : "bg-neutral-800 hover:bg-neutral-700",
                  ].join(" ")}
                >
                  #{id}
                </button>
              ))}
            </div>

            <button
              className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500"
              onClick={() => router.push(`/deck-builder?userId=${invUserId}`)}
            >
              Open Deck Builder
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
