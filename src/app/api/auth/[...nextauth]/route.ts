import NextAuth, { type NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import { getPool } from "@/lib/db";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

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

/** ---- DB row types ---- */
interface UserIdRow extends RowDataPacket {
  id: number;
}

/** Discord profile fields weสนใจ (หลีกเลี่ยง any) */
type MaybeDiscordProfile = Partial<
  Record<"email" | "global_name" | "username" | "name" | "image_url" | "avatar", string>
>;

/** ==== NextAuth options (no any) ==== */
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
      // ระบุ discord id (ถ้า login ด้วย discord)
      const discordId: string =
        account?.provider === "discord"
          ? account.providerAccountId
          : (token.sub ?? "");

      // profile ที่ได้จากผู้ให้บริการ (typed, not any)
      const p: MaybeDiscordProfile | null =
        (profile ?? null) as MaybeDiscordProfile | null;

      // รวมแหล่งข้อมูลแบบปลอดภัย ไม่ใช้ any
      const email: string | null = token.email ?? user?.email ?? p?.email ?? null;
      const username: string | null =
        token.name ??
        user?.name ??
        p?.global_name ??
        p?.username ??
        p?.name ??
        null;
      const avatar: string | null =
        token.picture ?? user?.image ?? p?.image_url ?? p?.avatar ?? null;

      let uid: string = discordId;

      // บันทึก/อัปเดตผู้ใช้ในฐานข้อมูล (ไม่ใช้ any)
      try {
        const pool = await getPool(); // pool จะมี type เป็น Pool อัตโนมัติ

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
        if (Array.isArray(rows) && rows.length > 0) {
          uid = String(rows[0].id);
        }
      } catch (err: unknown) {
        // ไม่ throw ต่อ เพื่อไม่ให้ login พังเวลา DB งอแง
        // และไม่ใช้ any
        // eslint-disable-next-line no-console
        console.warn("[nextauth] DB skipped:", err);
      }

      // เติมข้อมูลลง token
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
