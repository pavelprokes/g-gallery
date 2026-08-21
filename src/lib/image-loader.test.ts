import { afterEach, describe, expect, it, vi } from "vitest";
import imageLoader from "./image-loader";

describe("imageLoader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("cloudflare mode (production default)", () => {
    it("builds a Cloudflare transformation URL from an object key", () => {
      vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
      expect(imageLoader({ src: "galleries/abc/p1.jpg", width: 1080, quality: 82 })).toBe(
        "https://photos.example.cz/cdn-cgi/image/width=1080,quality=82,format=auto,fit=scale-down/galleries/abc/p1.jpg",
      );
    });

    it("defaults quality to 82", () => {
      vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
      expect(imageLoader({ src: "galleries/abc/p1.jpg", width: 640 })).toContain("quality=82");
    });

    it("is the fallback for an unrecognised transform mode", () => {
      vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
      vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "nonsense");
      expect(imageLoader({ src: "galleries/abc/p1.jpg", width: 640 })).toContain("/cdn-cgi/image/");
    });
  });

  describe("imgproxy mode (local Docker stack)", () => {
    it("builds an unsigned imgproxy URL", () => {
      vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "http://localhost:8080");
      vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "imgproxy");
      expect(imageLoader({ src: "galleries/abc/p1.jpg", width: 1080, quality: 82 })).toBe(
        "http://localhost:8080/insecure/rs:fit:1080:0/q:82/plain/galleries/abc/p1.jpg",
      );
    });
  });

  describe("none mode", () => {
    it("serves the object straight from the bucket", () => {
      vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "http://localhost:9000/g-gallery/");
      vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "none");
      expect(imageLoader({ src: "galleries/abc/p1.jpg", width: 1080 })).toBe(
        "http://localhost:9000/g-gallery/galleries/abc/p1.jpg",
      );
    });
  });

  it("passes through absolute URLs and local public assets untouched", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://photos.example.cz");
    expect(imageLoader({ src: "/logo.svg", width: 640 })).toBe("/logo.svg");
    expect(imageLoader({ src: "https://example.com/a.jpg", width: 640 })).toBe(
      "https://example.com/a.jpg",
    );
  });

  it("falls back to a local path without a delivery host", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "");
    expect(imageLoader({ src: "galleries/abc/p1.jpg", width: 640 })).toBe(
      "/galleries/abc/p1.jpg?w=640",
    );
  });
});
