import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OG_IMAGE, ogImageUrl, previewMetadata } from "./og-image";

describe("ogImageUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks Cloudflare for a 1200×630 JPEG, never the original", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz/");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "cloudflare");
    expect(ogImageUrl("galleries/abc/p1.jpg")).toBe(
      "https://photos.example.cz/cdn-cgi/image/width=1200,height=630,fit=cover,quality=80,format=jpeg/galleries/abc/p1.jpg",
    );
  });

  it("defaults to Cloudflare when no transform mode is set", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "");
    expect(ogImageUrl("k.jpg")).toContain("/cdn-cgi/image/width=1200,height=630,");
  });

  it("crops through imgproxy on the local stack", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "http://localhost:8080");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "imgproxy");
    expect(ogImageUrl("galleries/abc/p1.jpg")).toBe(
      "http://localhost:8080/insecure/rs:fill:1200:630/q:80/plain/galleries/abc/p1.jpg@jpg",
    );
  });

  it("serves the object as is when no transforms exist", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://bucket.example.cz");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "none");
    expect(ogImageUrl("k.jpg")).toBe("https://bucket.example.cz/k.jpg");
  });

  it("returns null without an image host", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "");
    expect(ogImageUrl("k.jpg")).toBeNull();
  });
});

describe("previewMetadata", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const base = { title: "Jáchym a Sophie", description: "Fotky", locale: "cs" as const };

  it("previews with the photo, as a large card", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "cloudflare");
    const { openGraph, twitter } = previewMetadata({ ...base, imageKey: "g/p1.jpg" });

    expect(openGraph).toMatchObject({
      title: "Jáchym a Sophie",
      locale: "cs_CZ",
      images: [
        {
          url: expect.stringContaining("/cdn-cgi/image/") as unknown,
          width: 1200,
          height: 630,
          type: "image/jpeg",
          alt: "Jáchym a Sophie",
        },
      ],
    });
    expect(twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("falls back to the branded card when there is no photo", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    const { openGraph, twitter } = previewMetadata({ ...base, imageKey: null });
    expect(openGraph).toMatchObject({ images: [{ url: DEFAULT_OG_IMAGE }] });
    expect(twitter).toMatchObject({ images: [DEFAULT_OG_IMAGE] });
  });

  it("falls back to the branded card when no image host is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "");
    const { openGraph } = previewMetadata({ ...base, imageKey: "g/p1.jpg" });
    expect(openGraph).toMatchObject({ images: [{ url: DEFAULT_OG_IMAGE }] });
  });
});
