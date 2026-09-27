/**
 * Retries any image that fails to load, up to three times (after 1, 2 and 4
 * seconds), by adding `retry=n` to its URLs — the same URL again would not be
 * requested again. A Cloudflare transformation of a large original can fail
 * once and succeed a second later, and a tile that stays blank for good is
 * worse than one that fills in late.
 *
 * Installed as an inline script at the top of <body> (src/app/layout.tsx), so
 * it also sees images that fail before React hydrates; `error` does not bubble,
 * hence the capture-phase listener on window. It must stay self-contained:
 * it is serialized with `toString()`.
 *
 * A component that swaps the source itself on error (the gallery grid's
 * thumbnail → original fallback) wins: a retry only fires if the image still
 * points where it did when it failed.
 */
export function installImageRetry(
  win: Window & typeof globalThis,
  maxRetries = 3,
  baseDelayMs = 1000,
): void {
  const bump = (value: string, attempt: number) => {
    try {
      const url = new URL(value, win.location.href);
      url.searchParams.set("retry", String(attempt));
      return url.href;
    } catch {
      return value;
    }
  };

  win.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!(img instanceof win.HTMLImageElement)) return;
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
      const attempt = Number(img.dataset.retry ?? "0") + 1;
      if (attempt > maxRetries) return;
      img.dataset.retry = String(attempt);

      win.setTimeout(
        () => {
          if (img.getAttribute("src") !== src) return;
          const srcset = img.getAttribute("srcset");
          if (srcset) {
            img.setAttribute(
              "srcset",
              srcset
                .split(",")
                .map((candidate) => {
                  const [url, ...descriptor] = candidate.trim().split(/\s+/);
                  return url ? [bump(url, attempt), ...descriptor].join(" ") : candidate;
                })
                .join(", "),
            );
          }
          img.setAttribute("src", bump(src, attempt));
        },
        baseDelayMs * 2 ** (attempt - 1),
      );
    },
    true,
  );
}
