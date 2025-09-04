import NextAuth, { type NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import { createPool } from "@/lib/db";
import type { Pool, RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** cache ให้ไม่สร้าง connection pool ใหม่ทุกรอบ */
let poolPromise: Promise<Pool> | null = null;
function getPool(): Promise<Pool> {
  if (!poolPromise) poolPromise = createPool();
  return poolPromise!;
}

/** ขยาย type ให้ token มี uid และ session.user.id ใช้งานได้ */
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

interface UserIdRow extends RowDataPacket {
  id: number;
}
type MaybeDiscordProfile = Partial<
  Record<"email" | "global_name" | "username" | "name" | "image_url" | "avatar", string>
>;

/** 🚫 อย่า export ตัวนี้ออกไปนะ ไม่งั้น Next.js จะ error */
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
      const discordId =
        account?.provider === "discord" ? account.providerAccountId : token.sub ?? "";

      const p: MaybeDiscordProfile | null = (profile ?? null) as MaybeDiscordProfile | null;

      const email: string | null = token.email ?? user?.email ?? p?.email ?? null;
      const username: string | null =
        token.name ?? user?.name ?? p?.global_name ?? p?.username ?? p?.name ?? null;
      const avatar: string | null = token.picture ?? user?.image ?? p?.image_url ?? p?.avatar ?? null;

      let uid = discordId;

      try {
        const pool = await getPool();
        await pool.query(
          `INSERT INTO users (discord_id, email, username, avatar)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             email = VALUES(email),
             username = VALUES(username),
             avatar = VALUES(avatar)`,
          [discordId, email, username, avatar]
        );
        const [rows] = await pool.execute<UserIdRow[]>(
          "SELECT id FROM users WHERE discord_id = ? LIMIT 1",
          [discordId]
        );
        if (rows.length) uid = String(rows[0].id);
      } catch (e) {
        console.warn("[nextauth] DB skipped:", e);
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
