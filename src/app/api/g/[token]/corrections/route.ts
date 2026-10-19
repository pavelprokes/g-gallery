import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { idSchema } from "@/lib/id-schema";
import { resolveShareLink } from "@/lib/share-access";
import { verifyPassword } from "@/lib/share-token";
import {
  isPinShaped,
  signCorrectionSession,
  verifyCorrectionSession,
} from "@/lib/correction-session";
import { pushToOwner } from "@/lib/push";

// The corrections mode (docs/CORRECTIONS.md): the couple, holding the link and
// its PIN, write corrections on photos. Every request re-resolves the share
// link — revocation, expiry, the password cookie — and every write also needs
// the session key the PIN opened, which the page keeps in memory only.

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const MAX_BODY = 1000;
/** A ceiling, not a policy: a wedding's worth of corrections is a few dozen. */
const MAX_COMMENTS_PER_LINK = 2000;
/** One push per burst of writing, not one per comment. */
const PUSH_QUIET_MS = 15 * 60 * 1000;

const point = z.number().min(0).max(1).nullish();
const bodyText = z.string().trim().min(1).max(MAX_BODY);
const sessionText = z.string().min(1).max(200);

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enter"), pin: z.string().max(20) }),
  z.object({
    action: z.literal("create"),
    session: sessionText,
    photoId: idSchema,
    body: bodyText,
    x: point,
    y: point,
  }),
]);
const patchSchema = z.object({
  session: sessionText,
  id: idSchema,
  body: bodyText.optional(),
  x: point,
  y: point,
});
const deleteSchema = z.object({ session: sessionText, id: idSchema });

const COMMENT_FIELDS = {
  id: true,
  photoId: true,
  body: true,
  x: true,
  y: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Gate =
  | { ok: true; link: { id: string; galleryId: string; correctionPinHash: string | null } }
  | { ok: false; response: NextResponse };

/** The link, if it is reachable and offers the mode. */
async function gate(token: string): Promise<Gate> {
  const access = await resolveShareLink(token);
  if (!access.ok) {
    return { ok: false, response: NextResponse.json({ error: access.reason }, { status: 403 }) };
  }
  if (!access.shareLink.allowCorrections) {
    return {
      ok: false,
      response: NextResponse.json({ error: "CORRECTIONS_DISABLED" }, { status: 403 }),
    };
  }
  const link = await prisma.shareLink.findUniqueOrThrow({
    where: { id: access.shareLink.id },
    select: { id: true, galleryId: true, correctionPinHash: true },
  });
  return { ok: true, link };
}

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("BETTER_AUTH_SECRET is required to sign correction sessions");
  return value;
}

const sessionDenied = () => NextResponse.json({ error: "PIN_REQUIRED" }, { status: 401 });

/** The link's comments, for a page in the mode. */
export async function GET(request: Request, ctx: RouteContext<"/api/g/[token]/corrections">) {
  const { token } = await ctx.params;
  const result = await gate(token);
  if (!result.ok) return result.response;
  const session = request.headers.get("x-correction-session");
  if (!verifyCorrectionSession(secret(), session, result.link.id, result.link.correctionPinHash)) {
    return sessionDenied();
  }
  const comments = await prisma.photoComment.findMany({
    where: { shareLinkId: result.link.id, photo: { status: "CONFIRMED" } },
    orderBy: { createdAt: "asc" },
    select: COMMENT_FIELDS,
  });
  return NextResponse.json({ comments });
}

export async function POST(request: Request, ctx: RouteContext<"/api/g/[token]/corrections">) {
  const { token } = await ctx.params;
  const result = await gate(token);
  if (!result.ok) return result.response;
  const { link } = result;

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (parsed.data.action === "enter") return enter(link.id, parsed.data.pin);

  const { session, photoId, body, x, y } = parsed.data;
  if (!verifyCorrectionSession(secret(), session, link.id, link.correctionPinHash)) {
    return sessionDenied();
  }
  // A photo of this gallery, never another's through this link.
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, galleryId: link.galleryId, status: "CONFIRMED" },
    select: { id: true, fileName: true },
  });
  if (!photo) return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  if (
    (await prisma.photoComment.count({ where: { shareLinkId: link.id } })) >= MAX_COMMENTS_PER_LINK
  ) {
    return NextResponse.json({ error: "too_many" }, { status: 429 });
  }

  const [comment, recent] = await Promise.all([
    prisma.photoComment.create({
      data: { photoId: photo.id, shareLinkId: link.id, body, x: x ?? null, y: y ?? null },
      select: COMMENT_FIELDS,
    }),
    prisma.activityEvent.findFirst({
      where: {
        galleryId: link.galleryId,
        type: "CORRECTION",
        createdAt: { gt: new Date(Date.now() - PUSH_QUIET_MS) },
      },
      select: { id: true },
    }),
  ]);
  await prisma.activityEvent.create({
    data: { galleryId: link.galleryId, photoId: photo.id, type: "CORRECTION" },
  });
  if (!recent) {
    const gallery = await prisma.gallery.findUniqueOrThrow({
      where: { id: link.galleryId },
      select: { id: true, ownerId: true, title: true },
    });
    // Best effort: the comment is saved whether or not a phone hears of it.
    await pushToOwner(gallery.ownerId, {
      title: `Připomínky · ${gallery.title}`,
      body: `${photo.fileName}: ${body.slice(0, 120)}`,
      url: `/admin/g/${gallery.id}?f=comments`,
    }).catch(() => undefined);
  }
  return NextResponse.json({ comment });
}

/** A comment of this link, not yet resolved by the photographer. */
async function ownComment(linkId: string, id: string) {
  return prisma.photoComment.findFirst({
    where: { id, shareLinkId: linkId },
    select: { id: true, resolvedAt: true },
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/g/[token]/corrections">) {
  const { token } = await ctx.params;
  const result = await gate(token);
  if (!result.ok) return result.response;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { session, id, body, x, y } = parsed.data;
  if (!verifyCorrectionSession(secret(), session, result.link.id, result.link.correctionPinHash)) {
    return sessionDenied();
  }
  const existing = await ownComment(result.link.id, id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Done is done: what the photographer already fixed stays as written.
  if (existing.resolvedAt) return NextResponse.json({ error: "resolved" }, { status: 409 });
  const comment = await prisma.photoComment.update({
    where: { id },
    data: {
      ...(body !== undefined ? { body } : {}),
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
    },
    select: COMMENT_FIELDS,
  });
  return NextResponse.json({ comment });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/g/[token]/corrections">) {
  const { token } = await ctx.params;
  const result = await gate(token);
  if (!result.ok) return result.response;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { session, id } = parsed.data;
  if (!verifyCorrectionSession(secret(), session, result.link.id, result.link.correctionPinHash)) {
    return sessionDenied();
  }
  const existing = await ownComment(result.link.id, id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.resolvedAt) return NextResponse.json({ error: "resolved" }, { status: 409 });
  await prisma.photoComment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

/** Wrong PINs in a row before the link refuses PINs for a while. */
const PIN_ATTEMPTS = 10;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;

/**
 * The PIN, rate-limited per link. An attempt is reserved under a row lock
 * *before* the scrypt check, so concurrent guesses each use one up — checking
 * first and counting after would let a burst of parallel requests through.
 *
 * Ten wrong PINs lock the link for five minutes: one million PINs at ten per
 * five minutes is years of guessing, while a holder of the link who is just
 * being a nuisance can only ever delay the couple by minutes. A lockout that
 * has run out starts the count afresh.
 */
async function enter(linkId: string, pin: string) {
  const now = new Date();
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "g_gallery"."ShareLink" WHERE id = ${linkId} FOR UPDATE`;
    const link = await tx.shareLink.findUniqueOrThrow({
      where: { id: linkId },
      select: {
        correctionPinHash: true,
        correctionFailedAttempts: true,
        correctionLockedUntil: true,
      },
    });
    const lockedUntil = link.correctionLockedUntil;
    if (lockedUntil && lockedUntil > now) return { kind: "locked", until: lockedUntil } as const;
    const expired = link.correctionLockedUntil !== null;
    const attempts = (expired ? 0 : link.correctionFailedAttempts) + 1;
    // The attempt that reaches the limit locks at once, before its own check
    // runs: no request after it gets a scrypt verification until the lock has
    // run out. A right PIN on that very attempt clears it again below.
    const lock = attempts >= PIN_ATTEMPTS ? new Date(now.getTime() + PIN_LOCKOUT_MS) : null;
    await tx.shareLink.update({
      where: { id: linkId },
      data: { correctionFailedAttempts: attempts, correctionLockedUntil: lock },
    });
    return { kind: "reserved", lock, pinHash: link.correctionPinHash } as const;
  });
  if (reserved.kind === "locked") {
    return NextResponse.json(
      { error: "locked", until: reserved.until.toISOString() },
      { status: 429 },
    );
  }

  const right =
    reserved.pinHash !== null && isPinShaped(pin) && (await verifyPassword(pin, reserved.pinHash));
  if (!right) {
    return reserved.lock
      ? NextResponse.json({ error: "locked", until: reserved.lock.toISOString() }, { status: 429 })
      : NextResponse.json({ error: "wrong_pin" }, { status: 401 });
  }
  await prisma.shareLink.update({
    where: { id: linkId },
    data: { correctionFailedAttempts: 0, correctionLockedUntil: null },
  });
  return NextResponse.json(signCorrectionSession(secret(), linkId, reserved.pinHash!));
}
