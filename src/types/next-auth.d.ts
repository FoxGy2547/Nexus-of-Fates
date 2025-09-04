// ให้ TypeScript รู้ว่ามี user.id เสมอใน session
import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;                 // ใช้ฝั่ง client
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;                 // เก็บ id (เลขใน DB หรือ discord id fallback)
  }
}
