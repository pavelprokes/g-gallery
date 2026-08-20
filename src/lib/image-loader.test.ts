import { afterEach, describe, expect, it, vi } from "vitest";
import cloudflareImageLoader from "./image-loader";

describe("cloudflareImageLoader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a Cloudflare transformation URL from an R2 object key", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    expect(cloudflareImageLoader({ src: "galleries/abc/p1.jpg", width: 1080, quality: 82 })).toBe(
      "https://photos.example.cz/cdn-cgi/image/width=1080,quality=82,format=auto,fit=scale-down/galleries/abc/p1.jpg",
    );
  });

  it("defaults quality to 82", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    expect(cloudflareImageLoader({ src: "galleries/abc/p1.jpg", width: 640 })).toContain(
      "quality=82",
    );
  });

  it("passes through absolute URLs and local public assets untouched", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    expect(cloudflareImageLoader({ src: "/logo.svg", width: 640 })).toBe("/logo.svg");
    expect(cloudflareImageLoader({ src: "https://example.com/a.jpg", width: 640 })).toBe(
      "https://example.com/a.jpg",
    );
  });

  it("falls back to a local path in dev without the CDN base", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "");
    expect(cloudflareImageLoader({ src: "galleries/abc/p1.jpg", width: 640 })).toBe(
      "/galleries/abc/p1.jpg?w=640",
    );
  });
});
