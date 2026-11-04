"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cacheKeyForToken,
  checkSpace,
  ensureServiceWorker,
  estimateBytes,
  fetchGalleryIndex,
  formatBytes,
  OFFLINE_META_PATH,
  offlineGridUrl,
  offlinePageUrl,
  offlineSupport,
  offlineUrls,
  requestPersistence,
  type OfflineMeta,
  type OfflineProgress,
} from "@/lib/offline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { OfflineIcon } from "@/components/ui/icons";

/**
 * "Keep this gallery on the device".
 *
 * Explicit, with the size shown before anything downloads: the viewer may well
 * be on mobile data. Google Photos does the same — offline is a choice per
 * album, never a side effect of opening one.
 */
type State = "checking" | "unsupported" | "off" | "downloading" | "on" | "no_space" | "error";

export function OfflineToggle({
  token,
  objectKeys,
  engagedObjectKeys,
  photoCount,
}: {
  token: string;
  /** The photos loaded so far — a fallback when the full list cannot be read. */
  objectKeys: readonly string[];
  engagedObjectKeys: readonly string[];
  /** The whole gallery's count, loaded or not: what "save all" means. */
  photoCount: number;
}) {
  // `offlineSupport()` reads `window`, so it can't run in the initializer:
  // the server has no `window` and would compute "unsupported" while the
  // client's first (pre-hydration) pass has a real one and would compute
  // "checking" — a straight SSR/CSR content mismatch. Both sides start at
  // "checking" (renders nothing) and the real answer arrives after mount.
  const t = useTranslations("gallery.offline");
  const locale = useLocale();
  const [state, setState] = useState<State>("checking");
  const [progress, setProgress] = useState<OfflineProgress | null>(null);
  const [free, setFree] = useState<number | null>(null);
  const [perPhotoBytes, setPerPhotoBytes] = useState(0);
  // Checked by default: narrowing to what the viewer actually engaged with
  // (reaction, print pick, grid selection) is the assumed intent once there
  // is anything to narrow to. Until then there's nothing to filter down to,
  // so it falls back to the whole gallery regardless of this flag.
  const [onlyEngaged, setOnlyEngaged] = useState(true);
  const [meta, setMeta] = useState<OfflineMeta | null>(null);
  const keyRef = useRef<string | null>(null);

  const effectiveOnlyEngaged = onlyEngaged && engagedObjectKeys.length > 0;
  // The whole gallery, not the pages the grid happens to have loaded: the
  // complete key list is read when the download starts (`fetchGalleryIndex`).
  // Engagement can only be read off the loaded photos, so that scope is what
  // it is — and the "N of M" line after saving says so.
  const activeCount = effectiveOnlyEngaged
    ? engagedObjectKeys.length
    : Math.max(photoCount, objectKeys.length);
  const estimated = perPhotoBytes * activeCount;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!offlineSupport().supported) {
        if (!cancelled) setState("unsupported");
        return;
      }

      const key = await cacheKeyForToken(token);
      // Null means no `crypto.subtle`, so no cache key and no offline storage
      // — presented as unsupported rather than half-working.
      if (cancelled) return;
      if (!key) {
        setState("unsupported");
        return;
      }
      keyRef.current = key;
      // Computed here, not during render: the estimate depends on the screen,
      // and the server-side render has no screen. One photo's worth, so the
      // total can be re-derived cheaply when the scope toggle changes.
      setPerPhotoBytes(estimateBytes(1));

      // A cache with roughly the expected number of entries means a previous
      // download finished. Safari may have evicted it in the meantime, which is
      // exactly why this is read from the cache rather than from localStorage.
      const cache = await caches.open(`gg-offline-${key}`);
      const stored = (await cache.keys()).length;
      const savedMeta = stored > 0 ? await readMeta(cache) : null;
      if (cancelled) return;
      setMeta(savedMeta);
      setState(stored > 0 ? "on" : "off");
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const start = useCallback(async () => {
    const key = keyRef.current;
    if (!key) return;

    setState("downloading");
    setProgress({
      done: 0,
      failed: 0,
      total: activeCount * 2,
      bytes: 0,
      aborted: null,
    });

    // Every page of the gallery, not just the ones scrolled to — both for the
    // keys to save and so the grid can lay itself out offline: the service
    // worker keeps these API pages for a saved gallery and answers the grid's
    // "next page" from them (public/sw.js). A failed page leaves the loaded
    // photos as a floor; the "N of M" line then tells the truth.
    const index = await fetchGalleryIndex(token, window.location.origin);
    const keys = effectiveOnlyEngaged
      ? [...engagedObjectKeys]
      : [...new Set([...index.objectKeys, ...objectKeys])];
    const total = Math.max(photoCount, index.complete ? index.objectKeys.length : 0, keys.length);

    const space = await checkSpace(perPhotoBytes * keys.length);
    setFree(space.free);
    if (!space.ok) {
      setState("no_space");
      return;
    }

    await requestPersistence();

    const worker = await ensureServiceWorker();
    if (!worker) {
      setState("error");
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as OfflineProgress & { type?: string; key?: string };
      if (data?.key !== key) return;

      if (data.type === "PRECACHE_PROGRESS") {
        setProgress({ ...data });
      } else if (data.type === "PRECACHE_DONE") {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        setProgress({ ...data });
        if (data.aborted === "quota" || data.done === 0) {
          setState(data.aborted === "quota" ? "no_space" : "error");
          return;
        }
        void writeMeta(key, keys, total).then((written) => {
          setMeta(written);
          setState("on");
        });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    worker.postMessage({
      type: "PRECACHE",
      key,
      urls: offlineUrls(keys, offlinePageUrl(window.location.href), index.pageUrls),
    });
  }, [
    activeCount,
    effectiveOnlyEngaged,
    engagedObjectKeys,
    objectKeys,
    perPhotoBytes,
    photoCount,
    token,
  ]);

  const remove = useCallback(async () => {
    const key = keyRef.current;
    if (!key) return;
    await caches.delete(`gg-offline-${key}`);
    setProgress(null);
    setMeta(null);
    setState("off");
  }, []);

  if (state === "checking") return null;

  if (state === "unsupported") {
    return (
      <>
        <Note>{t("unsupported")}</Note>
        <LiveRegion>{t("unsupported")}</LiveRegion>
      </>
    );
  }

  if (state === "no_space") {
    const message =
      free !== null
        ? t("notEnoughSpaceWithFree", {
            needed: formatBytes(estimated, locale),
            free: formatBytes(free, locale),
          })
        : t("notEnoughSpace", { needed: formatBytes(estimated, locale) });
    return (
      <div className="space-y-2">
        <Note>{message}</Note>
        <Button variant="secondary" onClick={() => setState("off")}>
          {t("tryAgain")}
        </Button>
        <LiveRegion>{message}</LiveRegion>
      </div>
    );
  }

  if (state === "downloading") {
    const total = progress?.total ?? 1;
    const done = (progress?.done ?? 0) + (progress?.failed ?? 0);
    const percent = Math.round((done / total) * 100);
    return (
      <div className="space-y-2">
        <p className="text-sm">
          {progress && progress.bytes > 0
            ? t("downloadingWithBytes", { percent, bytes: formatBytes(progress.bytes, locale) })
            : t("downloading", { percent })}
        </p>
        <div
          role="progressbar"
          aria-label={t("downloadingAriaLabel")}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
        >
          <div
            className="motion-loop duration-move ease-standard h-full bg-neutral-900 transition-[width] dark:bg-neutral-100"
            style={{ width: `${percent}%` }}
          />
        </div>
        <LiveRegion>{t("downloadStarted", { percent })}</LiveRegion>
      </div>
    );
  }

  if (state === "on") {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          {progress && progress.bytes > 0
            ? t("availableOfflineWithBytes", { bytes: formatBytes(progress.bytes, locale) })
            : t("availableOffline")}
        </p>
        {meta && meta.saved < meta.total && (
          <p className="text-sm">{t("savedOfTotal", { saved: meta.saved, total: meta.total })}</p>
        )}
        <p className="text-xs text-neutral-500">{t("availableOfflineNote")}</p>
        <Button variant="secondary" onClick={() => void remove()}>
          {t("removeFromDevice")}
        </Button>
        <LiveRegion>{t("availableOfflineAnnounce")}</LiveRegion>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-2">
        <Note>{t("downloadFailed")}</Note>
        <Button variant="secondary" onClick={() => void start()}>
          {t("tryAgain")}
        </Button>
        <LiveRegion>{t("downloadFailedAnnounce")}</LiveRegion>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">{t("saveOffline", { count: activeCount })}</p>
      <p className="text-xs text-neutral-500">
        {t("estimatedSize", { size: formatBytes(estimated, locale) })}
      </p>
      {engagedObjectKeys.length > 0 && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={onlyEngaged}
            onChange={(event) => setOnlyEngaged(event.target.checked)}
          />
          {t("onlyEngagedOption", { count: engagedObjectKeys.length })}
        </label>
      )}
      <Button onClick={() => void start()} disabled={activeCount === 0}>
        {t("makeAvailable")}
      </Button>
    </div>
  );
}

/**
 * The header toolbar's entry point — same icon-button chrome as Projekce and
 * download, next to them (docs/PLAN.md's grid header), instead of a permanent
 * card in the footer nobody scrolled to. `OfflineToggle` itself is unchanged:
 * all its states (checking a previous download, progress, no-space, error)
 * render inside this panel exactly as they did in the footer card.
 */
export function OfflineIconButton(props: {
  token: string;
  objectKeys: readonly string[];
  engagedObjectKeys: readonly string[];
  photoCount: number;
}) {
  const t = useTranslations("gallery.offline");
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Anchored by coordinates rather than CSS `right-0`: the button can sit
  // anywhere in the wrapped header row (it isn't always the row's last
  // item), so a fixed-width panel pinned to its right edge can run off the
  // left of the viewport on a narrow phone. Clamping to the viewport here
  // keeps it on-screen regardless of where the button ends up.
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 288,
  });

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 16;
      // Below the `sm` breakpoint the panel fills the width instead of
      // sitting in a narrow 288px popover with wasted space beside it.
      const width =
        window.innerWidth < 640
          ? window.innerWidth - margin * 2
          : Math.min(288, window.innerWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.right - width),
        window.innerWidth - margin - width,
      );
      setPanelStyle({ top: rect.bottom + 8, left, width });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  // `pointerdown`, not `mousedown`: iOS Safari fires no mouse events for a tap
  // on something that is not clickable (the page around the panel), so the
  // panel never closed on an iPhone. Escape closes it from the keyboard and
  // hands focus back to the button that opened it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      panelRef.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={panelRef} className="relative">
      <IconButton
        onClick={() => setOpen((prev) => !prev)}
        label={t("iconLabel")}
        aria-expanded={open}
        title={t("iconTitle")}
      >
        <OfflineIcon />
      </IconButton>
      {open && (
        <Card
          className="fixed z-20 bg-white dark:bg-neutral-900"
          style={{ top: panelStyle.top, left: panelStyle.left, width: panelStyle.width }}
        >
          <p className="mb-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {t("panelTitle")}
          </p>
          <OfflineToggle
            token={props.token}
            objectKeys={props.objectKeys}
            engagedObjectKeys={props.engagedObjectKeys}
            photoCount={props.photoCount}
          />
        </Card>
      )}
    </div>
  );
}

async function readMeta(cache: Cache): Promise<OfflineMeta | null> {
  try {
    const response = await cache.match(new URL(OFFLINE_META_PATH, location.origin).href);
    return response ? ((await response.json()) as OfflineMeta) : null;
  } catch {
    return null;
  }
}

/**
 * Counts what actually landed — a photo counts once its grid image is in the
 * cache — and records it beside the gallery, so the panel can say "N of M"
 * again after a reload. Read back from the cache rather than from the worker's
 * tally, which counts URLs (two per photo), not photos.
 */
async function writeMeta(
  key: string,
  objectKeys: readonly string[],
  total: number,
): Promise<OfflineMeta | null> {
  try {
    const cache = await caches.open(`gg-offline-${key}`);
    const stored = new Set((await cache.keys()).map((request) => request.url));
    const saved = new Set(
      objectKeys.filter((objectKey) =>
        stored.has(new URL(offlineGridUrl(objectKey), location.href).href),
      ),
    ).size;
    const meta: OfflineMeta = { saved, total: Math.max(total, saved) };
    await cache.put(
      new URL(OFFLINE_META_PATH, location.origin).href,
      new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }),
    );
    return meta;
  } catch {
    return null;
  }
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}

// Visually hidden status announcement for screen readers. Mirrors whatever
// Czech copy is already shown for the current state, so there's a single
// source of truth for the wording — this just makes it audible to AT too.
function LiveRegion({ children }: { children: React.ReactNode }) {
  return (
    <span className="sr-only" aria-live="polite">
      {children}
    </span>
  );
}
