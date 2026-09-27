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
  const withRetry = (value: string, attempt: number | null) => {
    try {
      const url = new URL(value, win.location.href);
      if (attempt === null) url.searchParams.delete("retry");
      else url.searchParams.set("retry", String(attempt));
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

      // The budget belongs to the URL, not to the element: the lightbox reuses
      // one <img> for every photo, and the grid swaps a failed thumbnail for
      // the original — each new picture starts with a full set of retries.
      const base = withRetry(src, null);
      const attempt = (img.dataset.retryFor === base ? Number(img.dataset.retry) : 0) + 1;
      if (attempt > maxRetries) return;
      img.dataset.retryFor = base;
      img.dataset.retry = String(attempt);

      win.setTimeout(
        () => {
          if (img.getAttribute("src") !== src) return;
          const srcset = img.getAttribute("srcset");
          if (srcset) {
            // Candidates are separated by a comma *and* whitespace (next/image
            // writes ", "): Cloudflare URLs carry bare commas of their own
            // ("width=384,quality=82"), so a plain split(",") would cut them.
            img.setAttribute(
              "srcset",
              srcset
                .split(/,\s+/)
                .map((candidate) => {
                  const [url, ...descriptor] = candidate.trim().split(/\s+/);
                  return url ? [withRetry(url, attempt), ...descriptor].join(" ") : candidate;
                })
                .join(", "),
            );
          }
          img.setAttribute("src", withRetry(src, attempt));
        },
        baseDelayMs * 2 ** (attempt - 1),
      );
    },
    true,
  );
}
