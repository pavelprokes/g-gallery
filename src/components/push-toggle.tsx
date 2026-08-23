"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Owner-side Web Push opt-in (docs/PLAN.md §8).
 *
 * Permission must be requested from a user gesture — a prompt fired on mount is
 * ignored by every browser and, worse, burns the one chance Safari gives you.
 * On iOS ≥ 16.4 push only works once the admin is added to the Home Screen, so
 * the button explains that rather than failing silently.
 */

type State = "loading" | "unsupported" | "needs-key" | "denied" | "off" | "on" | "busy";

/** Push needs both APIs; Safari on iOS lacks PushManager outside a Home Screen PWA. */
function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
  );
}

// Typed as Uint8Array<ArrayBuffer>, not the default ArrayBufferLike:
// applicationServerKey wants a BufferSource, which excludes SharedArrayBuffer.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  // VAPID keys are base64url; atob wants standard base64 with padding.
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushToggle() {
  // Always "loading" on the first render, never a support check: `pushSupported()`
  // reads `navigator`, so it is false on the server and true in the browser, and
  // the two renders disagreed — the server emitted the "unsupported" hint where
  // the client emitted nothing. Support is resolved in the effect below, which
  // only ever runs on the client.
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Inside the async body, not the effect's: the support check has to run on
      // the client, but a synchronous setState in an effect body is what the
      // react-hooks lint rule forbids.
      if (!pushSupported()) {
        setState("unsupported");
        return;
      }

      const response = await fetch("/api/push/subscribe").catch(() => null);
      const data = response?.ok ? ((await response.json()) as { publicKey: string | null }) : null;
      if (cancelled) return;

      if (!data?.publicKey) {
        setState("needs-key");
        return;
      }
      setPublicKey(data.publicKey);

      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      if (!cancelled) setState(existing ? "on" : "off");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!publicKey) return;
    setState("busy");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        // Chrome refuses a subscription that is not userVisibleOnly.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setState(response.ok ? "on" : "off");
    } catch {
      setState("off");
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setState("busy");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // Tell the server first: unsubscribing locally without it would leave a
        // row that keeps failing until the push service reports 410.
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
          method: "DELETE",
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }, []);

  if (state === "loading") return null;

  if (state === "unsupported") {
    return <Hint>Tento prohlížeč notifikace nepodporuje. Denní souhrn chodí e-mailem.</Hint>;
  }
  if (state === "needs-key") {
    return <Hint>Notifikace nejsou nastavené (chybí VAPID klíče) — souhrn chodí e-mailem.</Hint>;
  }
  if (state === "denied") {
    return <Hint>Notifikace jsou v prohlížeči zakázané. Povol je v nastavení webu.</Hint>;
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        disabled={state === "busy"}
        onClick={() => void (state === "on" ? disable() : enable())}
      >
        {state === "on" ? "Vypnout notifikace" : "Zapnout notifikace"}
      </Button>
      {state === "off" && (
        <span className="text-admin-muted text-xs dark:text-neutral-400">
          Na iPhonu funguje až po přidání na plochu.
        </span>
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-admin-muted text-xs dark:text-neutral-400">{children}</p>;
}
