"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeCorrectionDraft } from "@/components/corrections/corrections-helpers";

// The corrections mode on the guest side (docs/CORRECTIONS.md). The session
// key lives in this hook's state only: a reload, a closed tab or "Ukončit"
// forgets it, so every entry into the mode asks for the PIN again.

export interface Correction {
  id: string;
  photoId: string;
  body: string;
  x: number | null;
  y: number | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EnterResult =
  | { ok: true }
  | { ok: false; reason: "wrong_pin" }
  | { ok: false; reason: "locked"; until: Date }
  | { ok: false; reason: "error" };

/**
 * How adding a comment went. `session`: the key died under it (expired, new
 * PIN) — the text is kept and sent again after the next PIN.
 */
export type CreateResult = "ok" | "error" | "session";

export interface CorrectionsState {
  /** The link offers the mode at all. */
  available: boolean;
  active: boolean;
  /** The mode ended under the viewer (expired, PIN changed) — say so once. */
  expired: boolean;
  byPhoto: Map<string, Correction[]>;
  /** Photos with at least one correction, for the banner. */
  photoCount: number;
  enter: (pin: string) => Promise<EnterResult>;
  exit: () => void;
  create: (
    photoId: string,
    body: string,
    x: number | null,
    y: number | null,
    /** The draft to drop once the comment is saved, even by a retry after the PIN. */
    draftKey?: string,
  ) => Promise<CreateResult>;
  update: (
    id: string,
    patch: { body?: string; x?: number | null; y?: number | null },
  ) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

interface PendingCreate {
  photoId: string;
  body: string;
  x: number | null;
  y: number | null;
  draftKey?: string;
}

/** Sends a comment again under a fresh key; the saved comment, or null. */
export async function retryCreate(
  url: string,
  session: string,
  pending: PendingCreate,
): Promise<Correction | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create",
      photoId: pending.photoId,
      body: pending.body,
      x: pending.x,
      y: pending.y,
      session,
    }),
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as { comment?: Correction } | null;
  return data?.comment ?? null;
}

export function useCorrections(token: string, available: boolean): CorrectionsState {
  const [session, setSession] = useState<{ key: string; expiresAt: number } | null>(null);
  const [comments, setComments] = useState<Correction[]>([]);
  const [expired, setExpired] = useState(false);
  // A comment the server turned away for a dead key: sent again, with the new
  // key, as soon as the PIN is entered again.
  const pendingCreate = useRef<PendingCreate | null>(null);
  const url = `/api/g/${encodeURIComponent(token)}/corrections`;

  const end = useCallback((becauseExpired: boolean) => {
    setSession(null);
    setComments([]);
    setExpired(becauseExpired);
  }, []);

  // The key dies on the server at `expiresAt`; the mode closes with it.
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => end(true), Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session, end]);

  const fetchList = useCallback(
    (key: string): Promise<Correction[] | null> =>
      fetch(url, { headers: { "x-correction-session": key } })
        .then((r) => (r.ok ? (r.json() as Promise<{ comments: Correction[] }>) : null))
        .then((data) => data?.comments ?? null)
        .catch(() => null),
    [url],
  );

  const call = useCallback(
    async (
      method: "POST" | "PATCH" | "DELETE",
      body: Record<string, unknown>,
    ): Promise<Response | "session" | null> => {
      if (!session) return "session";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, session: session.key }),
      }).catch(() => null);
      // A new PIN or an expired key: out of the mode, with a word why.
      if (response?.status === 401) {
        end(true);
        return "session";
      }
      // Resolved by the photographer meanwhile: show it as such.
      if (response?.status === 409) {
        const list = await fetchList(session.key);
        if (list) setComments(list);
      }
      return response?.ok ? response : null;
    },
    [session, url, end, fetchList],
  );

  const enter = useCallback(
    async (pin: string): Promise<EnterResult> => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enter", pin }),
      }).catch(() => null);
      if (!response) return { ok: false, reason: "error" };
      const data = (await response.json().catch(() => ({}))) as {
        session?: string;
        ttlMs?: number;
        error?: string;
        until?: string;
      };
      if (response.ok && data.session && data.ttlMs) {
        // Without the list the couple would see none of their earlier
        // corrections and write them again: no list, no mode.
        const list = await fetchList(data.session);
        if (!list) return { ok: false, reason: "error" };
        // The comment the dead key turned away, sent before the panel opens
        // again — so its text is not offered a second time beside it.
        const pending = pendingCreate.current;
        pendingCreate.current = null;
        if (pending) {
          const saved = await retryCreate(url, data.session, pending);
          if (saved) {
            if (!list.some((c) => c.id === saved.id)) list.push(saved);
            if (pending.draftKey) writeCorrectionDraft(pending.draftKey, "");
          }
          // Otherwise its text is still the panel's draft, to send by hand.
        }
        setComments(list);
        // Timed by this device's own clock from now, with a margin.
        setSession({ key: data.session, expiresAt: Date.now() + data.ttlMs - 30_000 });
        setExpired(false);
        return { ok: true };
      }
      if (data.error === "locked" && data.until) {
        return { ok: false, reason: "locked", until: new Date(data.until) };
      }
      if (data.error === "wrong_pin") return { ok: false, reason: "wrong_pin" };
      return { ok: false, reason: "error" };
    },
    [url, fetchList],
  );

  const create = useCallback(
    async (
      photoId: string,
      body: string,
      x: number | null,
      y: number | null,
      draftKey?: string,
    ): Promise<CreateResult> => {
      const response = await call("POST", { action: "create", photoId, body, x, y });
      if (response === "session") {
        pendingCreate.current = { photoId, body, x, y, draftKey };
        return "session";
      }
      if (!response) return "error";
      const { comment } = (await response.json()) as { comment: Correction };
      setComments((prev) => [...prev, comment]);
      if (draftKey) writeCorrectionDraft(draftKey, "");
      return "ok";
    },
    [call],
  );

  const update = useCallback(
    async (id: string, patch: { body?: string; x?: number | null; y?: number | null }) => {
      const response = await call("PATCH", { id, ...patch });
      if (!response || response === "session") return false;
      const { comment } = (await response.json()) as { comment: Correction };
      setComments((prev) => prev.map((c) => (c.id === id ? comment : c)));
      return true;
    },
    [call],
  );

  const remove = useCallback(
    async (id: string) => {
      const response = await call("DELETE", { id });
      if (!response || response === "session") return false;
      setComments((prev) => prev.filter((c) => c.id !== id));
      return true;
    },
    [call],
  );

  const byPhoto = useMemo(() => {
    const map = new Map<string, Correction[]>();
    for (const comment of comments) {
      map.set(comment.photoId, [...(map.get(comment.photoId) ?? []), comment]);
    }
    return map;
  }, [comments]);

  return {
    available,
    active: session !== null,
    expired,
    byPhoto,
    photoCount: byPhoto.size,
    enter,
    exit: () => end(false),
    create,
    update,
    remove,
  };
}
