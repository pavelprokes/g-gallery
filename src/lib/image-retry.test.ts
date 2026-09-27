import { afterEach, describe, expect, it, vi } from "vitest";
import { installImageRetry } from "./image-retry";

// One install for the whole file: listeners on window cannot be removed.
installImageRetry(window, 3, 1000);

function failingImage(src: string, srcset?: string) {
  const img = document.createElement("img");
  img.setAttribute("src", src);
  if (srcset) img.setAttribute("srcset", srcset);
  document.body.append(img);
  return img;
}

const fail = (img: HTMLImageElement) => img.dispatchEvent(new Event("error"));

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("installImageRetry", () => {
  it("retries Cloudflare URLs, commas and all, on src and every srcset candidate", () => {
    vi.useFakeTimers();
    const cf = (w: number) =>
      `https://cdn.test/cdn-cgi/image/width=${w},quality=82,format=auto,fit=scale-down/g/a.jpg`;
    const img = failingImage(cf(384), `${cf(384)} 384w, ${cf(640)} 640w`);

    fail(img);
    vi.advanceTimersByTime(999);
    expect(img.getAttribute("src")).not.toContain("retry");
    vi.advanceTimersByTime(1);
    expect(img.getAttribute("src")).toBe(`${cf(384)}?retry=1`);
    expect(img.getAttribute("srcset")).toBe(`${cf(384)}?retry=1 384w, ${cf(640)}?retry=1 640w`);

    fail(img);
    vi.advanceTimersByTime(2000);
    expect(img.getAttribute("src")).toBe(`${cf(384)}?retry=2`);
  });

  it("gives every new picture in a reused element a full set of retries", () => {
    vi.useFakeTimers();
    const img = failingImage("https://cdn.test/a.jpg");
    for (let i = 0; i < 3; i++) {
      fail(img);
      vi.runAllTimers();
    }
    // The lightbox moves on to the next photo with the same <img>.
    img.setAttribute("src", "https://cdn.test/b.jpg");
    fail(img);
    vi.runAllTimers();
    expect(img.getAttribute("src")).toBe("https://cdn.test/b.jpg?retry=1");
  });

  it("gives up after three retries", () => {
    vi.useFakeTimers();
    const img = failingImage("https://cdn.test/a.jpg?w=1");
    for (let i = 0; i < 3; i++) {
      fail(img);
      vi.runAllTimers();
    }
    expect(img.getAttribute("src")).toBe("https://cdn.test/a.jpg?w=1&retry=3");
    fail(img);
    vi.runAllTimers();
    expect(img.getAttribute("src")).toBe("https://cdn.test/a.jpg?w=1&retry=3");
  });

  it("leaves an image alone once its own error handler has swapped the source", () => {
    vi.useFakeTimers();
    const img = failingImage("https://cdn.test/a.thumb.webp");
    fail(img);
    img.setAttribute("src", "https://cdn.test/cdn-cgi/image/width=384/a.jpg");
    vi.runAllTimers();
    expect(img.getAttribute("src")).toBe("https://cdn.test/cdn-cgi/image/width=384/a.jpg");
  });
});
