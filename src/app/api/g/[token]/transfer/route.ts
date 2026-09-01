import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import {
  TRANSFER_CODE_TTL_MS,
  formatTransferCode,
  generateTransferCode,
  normalizeTransferCode,
  transferCodeMaterial,
} from "@/lib/viewer-transfer";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Moving a viewer's own marks to another device (docs/PLAN.md §8a).
 *
 * POST mints a one-shot code for the viewer on this device; PUT redeems one on
 * the other device and hands back the `anonKey` to adopt. Both are scoped to a
 * gallery the caller can already open — the share link is resolved first, and
 * a code minted in one gallery cannot resolve in another because the gallery
 * id is salted into the hash.
 *
 * What this hands over is deliberately small: one `Viewer` row inside one
 * gallery, carrying favourites, reactions, print marks and a volunteered first
 * name. No email, no account, nothing that outlives the gallery.
 */

const mintSchema = z.object({ anonKey: z.uuid() });
const redeemSchema = z.object({ code: z.string().min(1).max(32) });

/** Only the hash is stored — same rule share tokens follow (invariant #5). */
function hashCode(galleryId: string, code: string): string {
  return createHash("sha256").update(transferCodeMaterial(galleryId, code)).digest("hex");
}

export async function POST(request: Request, ctx: RouteContext<"/api/g/[token]/transfer">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });

  const parsed = mintSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  // No upsert on the viewer here: a code is only useful to somebody who has
  // already marked something, and minting one would otherwise create an empty
  // viewer row for anyone who merely opened the panel.
  const viewer = await prisma.viewer.findUnique({
    where: {
      galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey: parsed.data.anonKey },
    },
    select: { id: true, optedOut: true },
  });
  if (!viewer) return NextResponse.json({ error: "NOTHING_TO_TRANSFER" }, { status: 404 });
  if (viewer.optedOut) return NextResponse.json({ error: "OPTED_OUT" }, { status: 403 });

  const code = generateTransferCode((n) => new Uint8Array(randomBytes(n)));
  const expiresAt = new Date(Date.now() + TRANSFER_CODE_TTL_MS);

  // One live code per viewer: asking again replaces the previous one, which is
  // also how a code read out to the wrong person is cancelled.
  await prisma.viewerTransfer.upsert({
    where: { viewerId: viewer.id },
    create: {
      viewerId: viewer.id,
      codeHash: hashCode(access.shareLink.galleryId, code),
      expiresAt,
    },
    update: { codeHash: hashCode(access.shareLink.galleryId, code), expiresAt },
  });

  // The only time the raw code exists outside the viewer's own screen.
  return NextResponse.json({ code: formatTransferCode(code), expiresAt: expiresAt.toISOString() });
}

export async function PUT(request: Request, ctx: RouteContext<"/api/g/[token]/transfer">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });

  const parsed = redeemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const code = normalizeTransferCode(parsed.data.code);
  // A malformed code and a wrong one answer identically: the viewer's next step
  // is the same either way, and distinguishing them only helps a guesser.
  if (!code) return NextResponse.json({ error: "INVALID_CODE" }, { status: 404 });

  const transfer = await prisma.viewerTransfer.findUnique({
    where: { codeHash: hashCode(access.shareLink.galleryId, code) },
    select: {
      id: true,
      expiresAt: true,
      viewer: { select: { anonKey: true, displayName: true, optedOut: true, galleryId: true } },
    },
  });

  // The gallery check is belt-and-braces — the hash is already salted with the
  // gallery id, so a code from another gallery cannot produce a row here at
  // all. It stays because the cost is one comparison and the failure it guards
  // against is handing someone another gallery's viewer.
  if (!transfer || transfer.viewer.galleryId !== access.shareLink.galleryId) {
    return NextResponse.json({ error: "INVALID_CODE" }, { status: 404 });
  }

  if (transfer.expiresAt.getTime() < Date.now()) {
    await prisma.viewerTransfer.delete({ where: { id: transfer.id } });
    return NextResponse.json({ error: "CODE_EXPIRED" }, { status: 410 });
  }

  if (transfer.viewer.optedOut) {
    return NextResponse.json({ error: "OPTED_OUT" }, { status: 403 });
  }

  // One shot. A code that stayed valid for its full 15 minutes after being used
  // would be a standing invitation in anyone's message history.
  await prisma.viewerTransfer.delete({ where: { id: transfer.id } });

  return NextResponse.json({
    anonKey: transfer.viewer.anonKey,
    displayName: transfer.viewer.displayName,
  });
}
