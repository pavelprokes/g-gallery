"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  create: (photoId: string, body: string, x: number | null, y: number | null) => Promise<boolean>;
  update: (
    id: string,
    patch: { body?: string; x?: number | null; y?: number | null },
  ) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function useCorrections(token: string, available: boolean): CorrectionsState {
  const [session, setSession] = useState<{ key: string; expiresAt: number } | null>(null);
  const [comments, setComments] = useState<Correction[]>([]);
  const [expired, setExpired] = useState(false);
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

  const call = useCallback(
    async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) => {
      if (!session) return null;
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, session: session.key }),
      }).catch(() => null);
      // A new PIN or an expired key: out of the mode, with a word why.
      if (response?.status === 401) end(true);
      return response?.ok ? response : null;
    },
    [session, url, end],
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
        expiresAt?: number;
        error?: string;
        until?: string;
      };
      if (response.ok && data.session && data.expiresAt) {
        const list = await fetch(url, { headers: { "x-correction-session": data.session } })
          .then((r) => (r.ok ? r.json() : { comments: [] }))
          .catch(() => ({ comments: [] }));
        setComments((list as { comments: Correction[] }).comments);
        setSession({ key: data.session, expiresAt: data.expiresAt });
        setExpired(false);
        return { ok: true };
      }
      if (data.error === "locked" && data.until) {
        return { ok: false, reason: "locked", until: new Date(data.until) };
      }
      if (data.error === "wrong_pin") return { ok: false, reason: "wrong_pin" };
      return { ok: false, reason: "error" };
    },
    [url],
  );

  const create = useCallback(
    async (photoId: string, body: string, x: number | null, y: number | null) => {
      const response = await call("POST", { action: "create", photoId, body, x, y });
      if (!response) return false;
      const { comment } = (await response.json()) as { comment: Correction };
      setComments((prev) => [...prev, comment]);
      return true;
    },
    [call],
  );

  const update = useCallback(
    async (id: string, patch: { body?: string; x?: number | null; y?: number | null }) => {
      const response = await call("PATCH", { id, ...patch });
      if (!response) return false;
      const { comment } = (await response.json()) as { comment: Correction };
      setComments((prev) => prev.map((c) => (c.id === id ? comment : c)));
      return true;
    },
    [call],
  );

  const remove = useCallback(
    async (id: string) => {
      const response = await call("DELETE", { id });
      if (!response) return false;
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
