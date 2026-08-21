import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { sendDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily digest of yesterday's activity, one email per owner (docs/PLAN.md §8).
 * Scheduled at 05:00 UTC so it lands at 07:00 Europe/Prague in summer.
 */
export async function GET(request: Request) {
  const env = serverEnv();

  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const now = new Date();

  // Only admins own galleries, so only they can have anything to report.
  const owners = await prisma.user.findMany({
    where: { role: "admin" },
    select: { id: true, email: true },
  });

  const results = await Promise.all(
    owners.map(async (owner) => ({
      email: owner.email,
      ...(await sendDigest(owner.id, owner.email, now, baseUrl)),
    })),
  );

  return NextResponse.json({ ok: true, results });
}
