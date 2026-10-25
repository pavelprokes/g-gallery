import "server-only";
import { prisma } from "@/lib/db";
import type { McpGrant, Prisma } from "@/generated/prisma/client";

export type { McpGrant };
export type GrantLookupColumn = "codeHash" | "accessHash" | "refreshHash" | "previousRefreshHash";
/**
 * A compare-and-set condition on the update: a code redeems only while unused,
 * a refresh token rotates only while it is still the current one. Two requests
 * racing with the same secret cannot both win.
 */
export type GrantGuard =
  { column: "codeUsedAt"; value: null } | { column: "refreshHash"; value: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const UNUSED_CODE_RETENTION_MS = DAY_MS;
const EXPIRED_GRANT_RETENTION_MS = 30 * DAY_MS;

export async function findGrant(column: GrantLookupColumn, hash: string): Promise<McpGrant | null> {
  return prisma.mcpGrant.findFirst({ where: { [column]: hash } });
}

export async function insertGrant(grant: Prisma.McpGrantUncheckedCreateInput): Promise<void> {
  await prisma.mcpGrant.create({ data: grant, select: { id: true } });
}

export async function updateGrant(
  id: string,
  guard: GrantGuard | null,
  patch: Prisma.McpGrantUpdateManyMutationInput,
): Promise<boolean> {
  const where: Prisma.McpGrantWhereInput = { id };
  if (guard?.column === "codeUsedAt") where.codeUsedAt = null;
  if (guard?.column === "refreshHash") where.refreshHash = guard.value;
  const { count } = await prisma.mcpGrant.updateMany({ where, data: patch });
  return count > 0;
}

/** Drops codes nobody redeemed and grants long past their refresh window. */
export async function pruneGrants(now: Date = new Date()): Promise<void> {
  await prisma.mcpGrant.deleteMany({
    where: {
      OR: [
        {
          codeUsedAt: null,
          codeExpiresAt: { lt: new Date(now.getTime() - UNUSED_CODE_RETENTION_MS) },
        },
        { refreshExpiresAt: { lt: new Date(now.getTime() - EXPIRED_GRANT_RETENTION_MS) } },
      ],
    },
  });
}
