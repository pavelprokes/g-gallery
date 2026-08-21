import type { NextConfig } from "next";
import { DEVICE_SIZES, IMAGE_SIZES, QUALITY } from "./src/lib/image-sizes";

const nextConfig: NextConfig = {
  images: {
    // All next/image traffic goes through the Cloudflare loader — never
    // through Vercel's /_next/image (CLAUDE.md invariant #1).
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    // Deliberately trimmed srcset: each (photo × width × quality) combo is a
    // billable unique transformation. The list lives in src/lib/image-sizes.ts
    // because the lightbox prefetch has to agree with it exactly.
    deviceSizes: [...DEVICE_SIZES],
    imageSizes: [...IMAGE_SIZES],
    qualities: [QUALITY],
  },
};

export default nextConfig;
