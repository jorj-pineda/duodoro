import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
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
