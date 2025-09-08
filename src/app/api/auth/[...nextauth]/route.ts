import NextAuth, { type NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import { getPool } from "@/lib/db"; // ✅ ใช้ singleton pool ตัวเดียวทั้งแอป
import type { RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── module augmentation: เพิ่มฟิลด์ที่อยากใส่ใน token/session ── */
declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;         // user id ภายในระบบ (หรือ discord id)
    name?: string | null; // ปล่อยให้ next-auth เก็บได้
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

type UserIdRow = RowDataPacket & { id: number };
type MaybeDiscordProfile = Partial<
  Record<"email" | "global_name" | "username" | "name" | "image_url" | "avatar", string>
>;

/* ────────────────────────────────────────────────────────────── */
/*                  NextAuth main configuration                  */
/* ────────────────────────────────────────────────────────────── */
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
    /** 
     * signIn: เรียก "ครั้งสำคัญ" ตอนล็อกอินเท่านั้น
     * -> อัพเซิร์ตผู้ใช้ใน DB ตรงนี้ เพื่อไม่ให้ jwt callback ยิง DB ถี่ ๆ
     */
    async signIn({ user, account, profile }) {
      try {
        const pool = getPool();

        const discordId =
          account?.provider === "discord" ? account.providerAccountId : null;

        const p = (profile ?? {}) as MaybeDiscordProfile;

        const email =
          user?.email ??
          p.email ??
          null;

        const username =
          user?.name ??
          p.global_name ??
          p.username ??
          p.name ??
          null;

        const avatar =
          (user as any)?.image ??
          p.image_url ??
          p.avatar ??
          null;

        // มี discordId ถึงจะอัพเซิร์ต
        if (discordId) {
          await pool.query(
            `INSERT INTO users (discord_id, email, username, avatar)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               email = VALUES(email),
               username = VALUES(username),
               avatar = VALUES(avatar)`,
            [discordId, email, username, avatar]
          );
        }
      } catch (e: any) {
        // ถ้า connection เต็ม/DB ล่ม ให้ข้ามได้ ไม่ต้อง fail login ทั้งหมด
        console.warn("[nextauth] signIn upsert skipped:", e?.code || e?.message);
      }
      return true;
    },

    /**
     * jwt: เบา ๆ — ไม่แตะ DB
     * ใส่เฉพาะข้อมูลที่ต้องการติดไปกับ token ก็พอ
     */
    async jwt({ token, account, user, profile }) {
      // ใช้ discord id เป็น uid (ถ้าไม่มี ก็ fallback เป็น sub เดิม)
      const uid =
        account?.provider === "discord"
          ? account.providerAccountId
          : token.sub ?? undefined;
      if (uid) token.uid = uid;

      // อัปเดตชื่อ/รูปถ้ามีข้อมูลเข้ามารอบแรก
      const p = (profile ?? {}) as MaybeDiscordProfile;
      const name = user?.name ?? token.name ?? p.global_name ?? p.username ?? p.name ?? null;
      const picture = (user as any)?.image ?? token.picture ?? p.image_url ?? p.avatar ?? null;

      if (name !== undefined) token.name = name;
      if (picture !== undefined) token.picture = picture;

      return token;
    },

    /** map token → session (ฝั่ง client ใช้งาน) */
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
