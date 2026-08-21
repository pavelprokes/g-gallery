"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cacheKeyForToken,
  checkSpace,
  ensureServiceWorker,
  estimateBytes,
  formatBytes,
  offlineSupport,
  offlineUrls,
  requestPersistence,
  type OfflineProgress,
} from "@/lib/offline";
import { FORMS, pluralize } from "@/lib/czech-plural";

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
}: {
  token: string;
  objectKeys: readonly string[];
}) {
  // Support is knowable at first render, so it belongs in the initial state
  // rather than in an effect that immediately re-renders.
  const [state, setState] = useState<State>(() =>
    offlineSupport().supported ? "checking" : "unsupported",
  );
  const [progress, setProgress] = useState<OfflineProgress | null>(null);
  const [free, setFree] = useState<number | null>(null);
  const [estimated, setEstimated] = useState(0);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!offlineSupport().supported) return;

    let cancelled = false;
    void (async () => {
      const key = await cacheKeyForToken(token);
      if (cancelled) return;
      keyRef.current = key;
      // Computed here, not during render: the estimate depends on the screen,
      // and the server-side render has no screen.
      setEstimated(estimateBytes(objectKeys.length));

      // A cache with roughly the expected number of entries means a previous
      // download finished. Safari may have evicted it in the meantime, which is
      // exactly why this is read from the cache rather than from localStorage.
      const cache = await caches.open(`gg-offline-${key}`);
      const stored = (await cache.keys()).length;
      if (!cancelled) setState(stored > 0 ? "on" : "off");
    })();

    return () => {
      cancelled = true;
    };
  }, [objectKeys.length, token]);

  const start = useCallback(async () => {
    const key = keyRef.current;
    if (!key) return;

    setState("downloading");
    setProgress({ done: 0, failed: 0, total: objectKeys.length * 2, bytes: 0, aborted: null });

    const space = await checkSpace(estimated);
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
        setProgress({ ...data });
        setState(data.aborted === "quota" ? "no_space" : data.done > 0 ? "on" : "error");
        navigator.serviceWorker.removeEventListener("message", onMessage);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    worker.postMessage({
      type: "PRECACHE",
      key,
      urls: offlineUrls(objectKeys, window.location.href),
    });
  }, [estimated, objectKeys]);

  const remove = useCallback(async () => {
    const key = keyRef.current;
    if (!key) return;
    await caches.delete(`gg-offline-${key}`);
    setProgress(null);
    setState("off");
  }, []);

  if (state === "checking") return null;

  if (state === "unsupported") {
    return <Note>Tenhle prohlížeč offline galerie nepodporuje.</Note>;
  }

  if (state === "no_space") {
    return (
      <div className="space-y-2">
        <Note>
          V zařízení není dost místa. Galerie potřebuje zhruba {formatBytes(estimated)}
          {free !== null && `, volno je ${formatBytes(free)}`}.
        </Note>
        <Button onClick={() => setState("off")}>Zkusit znovu</Button>
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
          Stahuji do zařízení… {percent}%
          {progress && progress.bytes > 0 && ` · ${formatBytes(progress.bytes)}`}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full bg-neutral-900 transition-all dark:bg-neutral-100"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (state === "on") {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          ✓ Galerie je dostupná offline
          {progress && progress.bytes > 0 && ` (${formatBytes(progress.bytes)})`}
        </p>
        <p className="text-xs text-neutral-500">
          Uložené fotky jsou ve zmenšené velikosti pro tuhle obrazovku, ne originály. Prohlížeč je
          může po čase sám uvolnit — na iPhonu zhruba po týdnu bez otevření; pak stačí stáhnout
          znovu.
        </p>
        <Button onClick={() => void remove()}>Odstranit ze zařízení</Button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-2">
        <Note>Stažení se nepodařilo dokončit.</Note>
        <Button onClick={() => void start()}>Zkusit znovu</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">
        Ulož si {pluralize(objectKeys.length, FORMS.photoAccusative)} do zařízení a prohlížej je i
        bez signálu.
      </p>
      <p className="text-xs text-neutral-500">
        Zabere zhruba {formatBytes(estimated)}. Ukládá se velikost pro tuhle obrazovku, ne
        originály.
      </p>
      <Button onClick={() => void start()}>Zpřístupnit offline</Button>
    </div>
  );
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded border px-3 py-1.5 text-sm">
      {children}
    </button>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}
