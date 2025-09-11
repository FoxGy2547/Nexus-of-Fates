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
    uid?: string;
    name?: string | null;
    picture?: string | null;
  }
}
declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

/** ---- Supabase admin client (service role) ---- */
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const supa =
  SUPA_URL && SUPA_SERVICE_ROLE
    ? createClient(SUPA_URL, SUPA_SERVICE_ROLE, { auth: { persistSession: false } })
    : null;

/** ลดความซับซ้อนของข้อมูลโปรไฟล์จาก Discord */
type MaybeDiscordProfile = Partial<
  Record<"email" | "global_name" | "username" | "name" | "image_url" | "avatar", string>
>;

/** ==== NextAuth options (ใช้ JWT, upsert ผู้ใช้ด้วย Supabase) ==== */
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
      const discordId: string =
        account?.provider === "discord" ? account.providerAccountId : (token.sub ?? "");

      const p = (profile ?? null) as MaybeDiscordProfile | null;
      const email: string | null = token.email ?? user?.email ?? p?.email ?? null;
      const username: string | null =
        token.name ?? user?.name ?? p?.global_name ?? p?.username ?? p?.name ?? null;
      const avatar: string | null = token.picture ?? user?.image ?? p?.image_url ?? p?.avatar ?? null;

      let uid: string = discordId;

      // upsert ผู้ใช้ในตาราง public.users ด้วย service role (ถ้าตั้ง env ไว้)
      if (supa) {
        try {
          const { data } = await supa
            .from("users")
            .upsert(
              {
                discord_id: discordId,
                email,
                username,
                avatar,
              },
              { onConflict: "discord_id" }
            )
            .select("id")
            .single();
          if (data?.id) uid = String(data.id);
        } catch (err) {
          console.warn("[nextauth] supabase upsert skipped:", err);
        }
      }

      token.uid = uid;
      if (username !== null && username !== undefined) token.name = username;
      if (avatar !== null && avatar !== undefined) token.picture = avatar;
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid ?? token.sub ?? session.user.email ?? undefined;
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
