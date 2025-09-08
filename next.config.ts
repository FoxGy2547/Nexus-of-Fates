import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // ปิด Strict Mode เฉพาะตอนพัฒนา เพื่อกัน useEffect ซ้อนใน dev
  reactStrictMode: isDev ? false : true,

  // แทนที่ images.domains (deprecated) ด้วย remotePatterns
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "media.discordapp.net" },
    ],
  },
};

export default nextConfig;
