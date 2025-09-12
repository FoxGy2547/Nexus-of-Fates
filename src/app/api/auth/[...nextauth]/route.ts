// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { type NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import { queryOne } from "@/lib/db";

/** Next.js route config */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---- Extend token & session ---- */
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

/* ---- DB row ---- */
type UserIdRow = { id: number };

/* ---- Helper type for discord profile ---- */
type MaybeDiscordProfile = Partial<
  Record<"email" | "global_name" | "username" | "name" | "image_url" | "avatar", string>
>;

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
      // ข้อมูลจาก provider / token
      const discordId: string =
        account?.provider === "discord" ? account.providerAccountId : (token.sub ?? "");

      const p = (profile ?? null) as MaybeDiscordProfile | null;

      const email: string | null = token.email ?? user?.email ?? p?.email ?? null;
      const username: string | null =
        token.name ?? user?.name ?? p?.global_name ?? p?.username ?? p?.name ?? null;
      const avatar: string | null =
        token.picture ?? user?.image ?? p?.image_url ?? p?.avatar ?? null;

      let uid: string = discordId;

      /**
       * สำคัญ: ทำ upsert เฉพาะ "ครั้งแรก" ที่มี account (ตอนกลับจาก Discord)
       * เพื่อตัดรอบเรียกซ้ำที่ทำให้ sequence กระโดด
       */
      if (account?.provider === "discord") {
        try {
          const row = await queryOne<UserIdRow>(
            `
            insert into public.users (discord_id, email, username, avatar, nexus_deal)
            values ($1, $2, $3, $4, 80)
            on conflict (discord_id) do update
              set email    = excluded.email,
                  username = excluded.username,
                  avatar   = excluded.avatar
            returning id;
            `,
            [discordId, email, username, avatar]
          );
          if (row?.id) uid = String(row.id);
        } catch (err) {
          console.warn("[nextauth] DB skipped:", err);
        }
      }

      // เติมข้อมูลลง token
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
