// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import Discord from "next-auth/providers/discord";
import { createClient } from "@supabase/supabase-js";

/** Next.js route config */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ==== Extend types for token & session ==== */
declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;           // our internal id (supabase public.users.id as string) or discord id fallback
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

/** ---- Supabase (optional but preferred) ---- */
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPA_ON = Boolean(SUPA_URL && SUPA_SERVICE_ROLE);
const supa = SUPA_ON
  ? createClient(SUPA_URL, SUPA_SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

type UserIdRow = { id: number };

/** ==== NextAuth options (JWT only, no Adapter DB) ==== */
const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      authorization: { params: { scope: "identify email" } },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user, profile }) {
      // derive discord id (or fallback to token.sub)
      const discordId: string =
        account?.provider === "discord" ? account.providerAccountId : (token.sub ?? "");

      const p = (profile ?? {}) as Record<string, unknown>;

      const email: string | null =
        (token.email as string | undefined) ??
        (user?.email ?? null);

      const username: string | null =
        (token.name as string | undefined) ??
        (user?.name ??
          (p["global_name"] as string | undefined) ??
          (p["username"] as string | undefined) ??
          (p["name"] as string | undefined) ??
          null);

      const avatar: string | null =
        (token.picture as string | undefined) ??
        (user?.image ??
          (p["image_url"] as string | undefined) ??
          (p["avatar"] as string | undefined) ??
          null);

      let uid = discordId;

      // upsert ผู้ใช้ลง Supabase ถ้ามีค่า env ครบ
      if (SOPA_ON && supa) {
        try {
          const { data, error } = await supa
            .from("users")
            .upsert(
              {
                discord_id: discordId,
                email,
                username,
                avatar,
              },
              { onConflict: "discord_id" },
            )
            .select("id")
            .maybeSingle();
          if (!error && data?.id) uid = String((data as UserIdRow).id);
        } catch (err) {
          console.warn("[nextauth] supabase upsert skipped:", err);
        }
      } else {
        console.warn("[nextauth] Supabase env missing — skip DB upsert");
      }

      token.uid = uid;
      if (username !== undefined) token.name = username;
      if (avatar !== undefined) token.picture = avatar;
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

// tiny typo fix above
const SOPA_ON = SUPA_ON;
