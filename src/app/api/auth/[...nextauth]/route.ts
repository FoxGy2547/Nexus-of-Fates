// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import { createClient } from "@supabase/supabase-js";

/** Next.js route config */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ==== Extend types for token & session ==== */
declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;            // discord_id (string)
    dbid?: number;           // users.id (numeric)
    name?: string | null;
    picture?: string | null;
  }
}
declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;           // keep as uid (discord id or fallback)
      dbid?: number;         // numeric id in DB
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

/** Supabase Admin (Service Role) */
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPA_ON = Boolean(SUPA_URL && SUPA_SERVICE_ROLE);

/** Minimal profile fields from Discord */
type MaybeDiscordProfile = Partial<
  Record<"email" | "global_name" | "username" | "name" | "image_url" | "avatar", string>
>;

/** Ensure a user row exists in Supabase; returns numeric id (or null) */
async function ensureUserInSupabase(opts: {
  discordId: string;
  email: string | null;
  username: string | null;
  avatar: string | null;
}): Promise<number | null> {
  if (!SUPA_ON) return null;

  const supa = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // 1) มีอยู่หรือยัง
  const { data: existing, error: selErr } = await supa
    .from("users")
    .select("id")
    .eq("discord_id", opts.discordId)
    .maybeSingle();

  if (!selErr && existing?.id) {
    // 2) อัปเดตข้อมูลล่าสุด
    await supa
      .from("users")
      .update({
        email: opts.email ?? null,
        username: opts.username ?? null,
        avatar: opts.avatar ?? null,
      })
      .eq("id", existing.id);
    return existing.id;
  }

  // 3) แทรกใหม่ + โบนัสผู้เล่นใหม่
  //    ถ้า schema ไม่มีคอลัมน์ nexus_deal จะ retry โดยตัดทิ้ง
  const basePayload: Record<string, unknown> = {
    discord_id: opts.discordId,
    email: opts.email ?? null,
    username: opts.username ?? null,
    avatar: opts.avatar ?? null,
  };

  // try with nexus_deal
  let insertedId: number | null = null;
  const tryInsert = async (payload: Record<string, unknown>) => {
    const { data, error } = await supa
      .from("users")
      .insert(payload)
      .select("id")
      .single();
    if (!error && data?.id) insertedId = data.id;
    return { error };
  };

  const { error: insErr1 } = await tryInsert({ ...basePayload, nexus_deal: 80 });
  if (insErr1) {
    // retry without nexus_deal (รองรับกรณีคอลัมน์ไม่มี)
    await tryInsert(basePayload);
  }

  return insertedId;
}

/** ==== NextAuth options (JWT strategy) ==== */
const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      authorization: { params: { scope: "identify email" } },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user, profile }) {
      // discord id จาก provider (หรือใช้ sub เป็น fallback)
      const discordId: string =
        account?.provider === "discord"
          ? account.providerAccountId
          : (token.sub ?? "");

      const p: MaybeDiscordProfile | null =
        (profile ?? null) as MaybeDiscordProfile | null;

      const email: string | null = token.email ?? user?.email ?? p?.email ?? null;
      const username: string | null =
        token.name ?? user?.name ?? p?.global_name ?? p?.username ?? p?.name ?? null;
      const avatar: string | null =
        token.picture ?? user?.image ?? p?.image_url ?? p?.avatar ?? null;

      // เขียน/อัปเดตลง Supabase
      try {
        const dbid = await ensureUserInSupabase({
          discordId,
          email,
          username,
          avatar,
        });
        if (dbid != null) token.dbid = dbid;
      } catch (err) {
        console.warn("[nextauth] ensureUserInSupabase failed:", err);
      }

      // เติมข้อมูลลง token
      token.uid = discordId || token.uid;
      if (username !== undefined) token.name = username;
      if (avatar !== undefined) token.picture = avatar;

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        // keep both ids
        session.user.id = token.uid ?? token.sub ?? session.user.email ?? undefined;
        session.user.dbid = token.dbid;
        if (token.name !== undefined) session.user.name = token.name;
        if (token.picture !== undefined) session.user.image = token.picture;
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      return baseUrl;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
