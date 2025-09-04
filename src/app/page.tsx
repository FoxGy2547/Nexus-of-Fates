"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";

/** helper เรียก API game */
async function post<T = any>(body: unknown): Promise<T> {
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

function randRoom(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [createCode, setCreateCode] = useState<string>(randRoom());
  const [joinCode, setJoinCode] = useState<string>("");

  const user = useMemo(() => {
    const id = ((session?.user as any)?.id ?? session?.user?.email ?? "guest") as string;
    return {
      userId: id,
      name: session?.user?.name ?? "Player",
      avatar: session?.user?.image ?? null,
    };
  }, [session]);

  async function onCreate() {
    try {
      const roomId = (createCode || randRoom()).toUpperCase();
      const res = await post<{ ok: boolean; roomId: string }>(
        { action: "createRoom", roomId, user }
      );
      router.push(`/play/${res.roomId}`);
    } catch (e: any) {
      alert(`Create failed: ${e?.message || "unknown"}`);
    }
  }

  async function onJoin() {
    try {
      const roomId = (joinCode || "").trim().toUpperCase();
      if (!roomId) return alert("กรอกรหัสห้องก่อนนะ");
      const res = await post<{ ok: boolean; roomId: string }>(
        { action: "joinRoom", roomId, user }
      );
      router.push(`/play/${res.roomId}`);
    } catch (e: any) {
      alert(`Join failed: ${e?.message || "unknown"}`);
    }
  }

  return (
    <main className="min-h-screen p-6 flex flex-col gap-8">
      <h1 className="text-2xl font-bold">Nexus of Fates</h1>

      {/* auth */}
      <section className="flex items-center gap-3">
        {status === "authenticated" ? (
          <>
            {session.user?.image && (
              <img src={session.user.image} alt="" className="w-8 h-8 rounded-full" />
            )}
            <span>{session.user?.name ?? "Discord User"}</span>
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
