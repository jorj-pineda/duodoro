import type { NextConfig } from "next";
import { browserSecurityHeaders } from "./src/lib/securityHeaders";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [{ source: "/:path*", headers: browserSecurityHeaders({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL,
      development: process.env.NODE_ENV === "development",
      preview: process.env.VERCEL_ENV === "preview",
    }) }];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.duodoro.live" }],
        destination: "https://duodoro.live/:path*",
        permanent: true,
      },
    ];
  },
  // Vercel supplies its own deployment adapter and does not consume the
  // self-hosted standalone bundle. Next.js 16.3 currently omits the root NFT
  // trace when both are enabled, which makes Vercel's build finalizer fail.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
