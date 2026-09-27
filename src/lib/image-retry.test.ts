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
  it("retries with a retry param on src and every srcset candidate, backing off", () => {
    vi.useFakeTimers();
    const img = failingImage(
      "https://cdn.test/cdn-cgi/image/width=384/a.jpg",
      "https://cdn.test/cdn-cgi/image/width=384/a.jpg 384w, https://cdn.test/cdn-cgi/image/width=640/a.jpg 640w",
    );

    fail(img);
    vi.advanceTimersByTime(999);
    expect(img.getAttribute("src")).not.toContain("retry");
    vi.advanceTimersByTime(1);
    expect(img.getAttribute("src")).toBe("https://cdn.test/cdn-cgi/image/width=384/a.jpg?retry=1");
    expect(img.getAttribute("srcset")).toBe(
      "https://cdn.test/cdn-cgi/image/width=384/a.jpg?retry=1 384w, https://cdn.test/cdn-cgi/image/width=640/a.jpg?retry=1 640w",
    );

    fail(img);
    vi.advanceTimersByTime(2000);
    expect(img.getAttribute("src")).toContain("retry=2");
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
