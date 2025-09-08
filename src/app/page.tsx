"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import Image from "next/image";

/** เรียก API game (generic, ไม่ใช้ any) */
async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText);
  }
  return res.json() as Promise<T>;
}

/** userId เสถียรทั้งแอป */
function stableUserId(session: Session | null | undefined): string {
  if (typeof window === "undefined") return "ssr";
  const authId =
    session?.user?.id ??
    session?.user?.email ??
    null;
  if (authId) return String(authId);
  const key = "NOF_guestId";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

function randRoom(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

type CreateJoinResponse = { ok: boolean; roomId: string };

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [createCode, setCreateCode] = useState<string>(randRoom());
  const [joinCode, setJoinCode] = useState<string>("");

  const user = useMemo(() => {
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
      const res = await post<CreateJoinResponse>({ action: "createRoom", roomId, user });
      router.push(`/play/${res.roomId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      alert(`Create failed: ${msg}`);
    }
  }

  async function onJoin() {
    try {
      const roomId = (joinCode || "").trim().toUpperCase();
      if (!roomId) { alert("กรอกรหัสห้องก่อนนะ"); return; }
      const res = await post<CreateJoinResponse>({ action: "joinRoom", roomId, user });
      router.push(`/play/${res.roomId}`);
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
            <button className="px-3 py-1 rounded bg-red-600" onClick={() => signOut()}>
              Logout
            </button>
          </>
        ) : (
          <button className="px-3 py-1 rounded bg-indigo-600" onClick={() => signIn("discord")}>
            Login with Discord
          </button>
        )}
      </section>

      {/* create / host */}
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
            <button
              className="px-4 py-2 rounded bg-emerald-600 disabled:opacity-50"
              disabled={status !== "authenticated"}
              onClick={onCreate}
            >
              Create
            </button>
          </div>
          <p className="mt-2 text-xs opacity-70">
            โฮสต์จะถูกกำหนดเป็นฝั่ง p1 โดยอัตโนมัติ
          </p>
        </div>

        {/* join */}
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
              className="px-4 py-2 rounded bg-sky-600 disabled:opacity-50"
              disabled={status !== "authenticated" || !joinCode}
              onClick={onJoin}
            >
              Join
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
