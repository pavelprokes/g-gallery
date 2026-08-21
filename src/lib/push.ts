import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/db";

/**
 * Web Push straight to the browser vendors' push services — no third party,
 * no per-message cost (docs/PLAN.md §8).
 *
 * iOS ≥ 16.4 only delivers push to a PWA added to the Home Screen, and only
 * after a permission prompt triggered by a tap. That friction is why the daily
 * digest is the primary channel and this is an enhancement.
 */

/** Two pushes about the same gallery inside this window is nagging, not news. */
const THROTTLE_MS = 30 * 60 * 1000;

let configured: boolean | undefined;

/** VAPID keys are optional: without them push is skipped, never fatal. */
function ensureConfigured(): boolean {
  if (configured !== undefined) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    configured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushResult {
  sent: number;
  pruned: number;
  skipped: "not_configured" | "throttled" | null;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/**
 * Pushes to every subscription the owner registered.
 *
 * A 404 or 410 from the push service means the subscription is permanently
 * dead (browser data cleared, PWA removed) — those rows are deleted rather
 * than retried forever. Any other failure is left alone; it may be transient.
 */
export async function pushToOwner(ownerId: string, payload: PushPayload): Promise<PushResult> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0, skipped: "not_configured" };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: ownerId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  let sent = 0;
  let pruned = 0;
  const dead: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastSuccessAt: new Date() },
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(sub.id);
      }
    }),
  );

  if (dead.length > 0) {
    const { count } = await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
    pruned = count;
  }

  return { sent, pruned, skipped: null };
}

/**
 * Push about a new visit, at most once per gallery per THROTTLE_MS.
 *
 * The throttle is claimed with a conditional update rather than a read-then-
 * write: two viewers arriving at the same moment would otherwise both see a
 * stale timestamp and both push.
 */
export async function pushNewViewer(
  galleryId: string,
  viewerName: string | null,
): Promise<PushResult> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0, skipped: "not_configured" };

  const cutoff = new Date(Date.now() - THROTTLE_MS);
  const { count } = await prisma.gallery.updateMany({
    where: {
      id: galleryId,
      OR: [{ lastInstantPushAt: null }, { lastInstantPushAt: { lt: cutoff } }],
    },
    data: { lastInstantPushAt: new Date() },
  });
  if (count === 0) return { sent: 0, pruned: 0, skipped: "throttled" };

  const gallery = await prisma.gallery.findUnique({
    where: { id: galleryId },
    select: { title: true, ownerId: true },
  });
  if (!gallery) return { sent: 0, pruned: 0, skipped: null };

  return pushToOwner(gallery.ownerId, {
    title: gallery.title,
    body: viewerName ? `${viewerName} si prohlíží galerii` : "Někdo si prohlíží galerii",
    url: `/admin/g/${galleryId}`,
  });
}

/** The key the browser needs to subscribe. Public by design. */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}
