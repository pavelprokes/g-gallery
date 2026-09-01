import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import {
  reconcileGhostUploads,
  renderSweepReport,
  sweepIsNoteworthy,
  sweepOrphanObjects,
  type SweepResult,
} from "@/lib/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const env = serverEnv();

  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Ghost rows first: it deletes their objects, so the sweep that follows has
  // nothing left to find for them and the two never race over the same key.
  const ghosts = await reconcileGhostUploads();

  // ListObjectsV2 costs a Class A operation per 1000 keys, so the sweep is
  // opt-in per run rather than part of every nightly reconcile.
  const sweepRequested = new URL(request.url).searchParams.get("sweep") === "1";
  const sweep = sweepRequested ? await sweepOrphanObjects() : null;

  // A destructive job whose only record is the response body of a cron nobody
  // reads is a job that can delete the bucket unnoticed — which is how the
  // 2026-09-01 thumbnail loss went a week without being spotted.
  const reported = sweep && sweepIsNoteworthy(sweep) ? await reportSweep(sweep) : null;

  return NextResponse.json({ ok: true, ...ghosts, sweep, reported });
}

async function reportSweep(sweep: SweepResult) {
  const owners = await prisma.user.findMany({
    where: { role: "admin" },
    select: { email: true },
  });

  const { subject, text } = renderSweepReport(sweep);

  return Promise.all(
    owners.map(async (owner) => ({
      email: owner.email,
      ...(await sendMail({ to: owner.email, subject, text, html: `<pre>${text}</pre>` })),
    })),
  );
}
