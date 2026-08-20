import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // All next/image traffic goes through the Cloudflare loader — never
    // through Vercel's /_next/image (CLAUDE.md invariant #1).
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    // Deliberately trimmed srcset: each (photo × width × quality) combo is a
    // billable unique transformation. Default Next.js sizes (16 widths) can
    // 4× the quota burn (docs/PLAN.md §6).
    deviceSizes: [640, 1080, 1920, 2560],
    imageSizes: [384],
    qualities: [82],
  },
};

export default nextConfig;
