import "server-only";
import { headers } from "next/headers";
import { auth, type Session } from "@/lib/auth";

/**
 * Authoritative session check. `proxy.ts` only does an optimistic cookie test,
 * and Server Actions are publicly reachable POST endpoints — so every action
 * and route handler must call this (CLAUDE.md invariant #3).
 */
export async function requireAdmin(): Promise<Session> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("UNAUTHORIZED");
  if (session.user.role !== "admin") throw new Error("FORBIDDEN");
  return session;
}

/** Same check, but returns null instead of throwing (for pages that redirect). */
export async function getAdminSession(): Promise<Session | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return null;
  return session;
}
