import "server-only";
import { prisma } from "@/lib/db";
import type { McpCaller } from "./types";

type CallerLookup = { id: string } | { email: string };

/**
 * The same gate as the admin (`requireAdmin`): role `admin`, not banned.
 * Read live on every request, so taking the role away — or banning the
 * account — cuts every connected Claude off at once.
 */
export async function loadAdminCaller(
  lookup: CallerLookup,
  now: Date = new Date(),
): Promise<Omit<McpCaller, "origin"> | null> {
  const user = await prisma.user.findFirst({
    where: "id" in lookup ? { id: lookup.id } : { email: lookup.email.trim().toLowerCase() },
    select: { id: true, email: true, role: true, banned: true, banExpires: true },
  });
  if (!user || user.role !== "admin") return null;
  if (user.banned && (!user.banExpires || user.banExpires > now)) return null;
  return { userId: user.id, email: user.email };
}
