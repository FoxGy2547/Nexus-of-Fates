import NextAuth, { type NextAuthOptions } from "next-auth";
import Discord from "next-auth/providers/discord";
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

interface UserIdRow extends RowDataPacket { id: number }

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },

  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: { params: { scope: "identify email" } },
    }),
  ],

  callbacks: {
    /**
     * ทุกครั้งที่ออก JWT
     * - พยายาม upsert ผู้ใช้ลง DB (ถ้า DB ล่ม/ไม่พร้อม จะข้ามอย่างสุภาพ)
     * - เซ็ต token.uid ให้ใช้ใน session callback
     */
    async jwt({ token, account, user, profile }) {
      // id ฝั่ง Discord ที่เสถียร
      const discordId =
        account?.provider === "discord"
          ? account.providerAccountId
          : token.sub ?? "";

      // เก็บค่าที่พอมี
      const email =
        (token.email as string | null) ??
        (user?.email as string | null) ??
        ((profile as any)?.email ?? null);

      const username =
        (token.name as string | null) ??
        (user?.name as string | null) ??
        ((profile as any)?.global_name ??
          (profile as any)?.username ??
          (profile as any)?.name ??
          null);

      const avatar =
        (token.picture as string | null) ??
        (user?.image as string | null) ??
        ((profile as any)?.image_url ??
          (profile as any)?.avatar ??
          null);

      let uid: string = discordId; // default fallback = discord id (string)

      // พยายามแตะ DB อย่างสุภาพ
      try {
        const pool = await getPool();

        // upsert ผู้ใช้
        await pool.query(
          `INSERT INTO users (discord_id, email, username, avatar)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             email = VALUES(email),
             username = VALUES(username),
             avatar = VALUES(avatar)`,
          [discordId, email, username, avatar]
        );

        // ดึง user.id (เลข autoincrement) มาใช้เป็น uid
        const [rows] = await pool.query<UserIdRow[]>(
          "SELECT id FROM users WHERE discord_id = ? LIMIT 1",
          [discordId]
        );
        if (rows.length) uid = String(rows[0].id);
      } catch (e) {
        // ไม่ทำให้ล้ม — แค่ log แล้วใช้ fallback ต่อไป
        console.warn("[nextauth] DB skipped:", e);
      }

      (token as any).uid = uid;
      // เผื่อให้ค่า name/picture ติดอยู่ใน token เสมอ
      if (username) token.name = username;
      if (avatar) token.picture = avatar;

      return token;
    },

    /**
     * ใส่ user.id ลง session ให้ฝั่ง client ใช้งานสะดวก
     */
    async session({ session, token }) {
      // ปกติ next-auth รับประกันว่ามี session.user อยู่แล้ว
      if (session.user) {
        (session.user as any).id = (token as any).uid as string;
        // sync ชื่อ/รูปจาก token เผื่อกรณี Discord เปลี่ยน
        if (token.name) session.user.name = token.name as string;
        if (token.picture) session.user.image = token.picture as string;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
