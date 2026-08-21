import "server-only";
import { prisma } from "@/lib/db";
import { sendMail, type MailResult } from "@/lib/mailer";
import { FORMS, pluralize } from "@/lib/czech-plural";

/**
 * The daily digest — the reliable half of the notification pipeline
 * (docs/PLAN.md §8). Web Push on iOS needs the admin PWA on the Home Screen and
 * a permission tap, so push is treated as an enhancement and email as primary.
 *
 * Sent once a day rather than per event: Google Photos emails only for a new
 * album and keeps ongoing activity in-app, and an email per reaction would
 * train the owner to filter the sender.
 */

export interface DigestGallery {
  galleryId: string;
  title: string;
  views: number;
  uniqueViewers: number;
  reactions: number;
  favorites: number;
  downloads: number;
  newVisitors: string[];
}

export interface DigestData {
  since: Date;
  until: Date;
  galleries: DigestGallery[];
  totalEvents: number;
}

/**
 * A zone's UTC offset at a given instant.
 *
 * Both sides are formatted the same way, so the sub-second precision both drop
 * cancels out and the difference is exactly the offset. Taking the difference
 * against the raw Date instead would fold the current milliseconds into the
 * result — which is what made the window drift on every call.
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const asUtc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const asZone = new Date(at.toLocaleString("en-US", { timeZone }));
  return asZone.getTime() - asUtc.getTime();
}

/**
 * Yesterday in Europe/Prague, which is when the owner thinks a day starts.
 *
 * Must be **stable for every instant within the same day**: the window doubles
 * as the idempotency key for "have I already emailed this?", so a value that
 * shifts by milliseconds between two invocations lets a duplicate cron delivery
 * send the digest twice.
 */
export function digestWindow(now: Date): { since: Date; until: Date } {
  const offset = zoneOffsetMs(now, "Europe/Prague");

  // Shift into Prague terms, then read the calendar date with UTC getters so
  // the machine's own timezone never enters the calculation.
  const shifted = new Date(now.getTime() + offset);
  const midnightShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );

  const until = new Date(midnightShifted - offset);
  const since = new Date(until.getTime() - 24 * 60 * 60 * 1000);
  return { since, until };
}

/** Aggregates one owner's activity for the window. Empty means "do not send". */
export async function collectDigest(
  ownerId: string,
  since: Date,
  until: Date,
): Promise<DigestData> {
  const galleries = await prisma.gallery.findMany({
    where: {
      ownerId,
      // Only galleries that saw something; the rest would be zero rows anyway.
      events: { some: { createdAt: { gte: since, lt: until } } },
    },
    select: {
      id: true,
      title: true,
      events: {
        where: { createdAt: { gte: since, lt: until } },
        select: { type: true, viewerId: true },
      },
      sessions: {
        where: { startedAt: { gte: since, lt: until } },
        select: { viewerId: true },
      },
      viewers: {
        where: { firstSeenAt: { gte: since, lt: until }, optedOut: false },
        select: { displayName: true },
      },
    },
  });

  const rows: DigestGallery[] = galleries.map((gallery) => {
    const count = (type: string) => gallery.events.filter((e) => e.type === type).length;
    return {
      galleryId: gallery.id,
      title: gallery.title,
      // Views are sessions, not events — a heartbeat is not a visit.
      views: gallery.sessions.length,
      uniqueViewers: new Set(gallery.sessions.map((s) => s.viewerId)).size,
      reactions: count("REACTION"),
      favorites: count("FAVORITE"),
      downloads: count("DOWNLOAD"),
      newVisitors: gallery.viewers
        .map((v) => v.displayName)
        .filter((name): name is string => Boolean(name)),
    };
  });

  const totalEvents = rows.reduce(
    (sum, row) => sum + row.views + row.reactions + row.favorites + row.downloads,
    0,
  );

  return { since, until, galleries: rows, totalEvents };
}

export function renderDigest(
  data: DigestData,
  baseUrl: string,
): { subject: string; html: string; text: string } {
  const day = data.since.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Prague",
  });

  const headline =
    data.galleries.length === 1 && data.galleries[0]
      ? data.galleries[0].title
      : `${data.galleries.length} galerií`;
  const subject = `Aktivita v galeriích — ${headline}, ${day}`;

  const lines = data.galleries.map((g) => {
    const visitors = g.newVisitors.length > 0 ? `\n  Noví: ${g.newVisitors.join(", ")}` : "";
    return `${g.title}\n  ${summarize(g).join(" · ")}${visitors}`;
  });

  const text = [`Aktivita za ${day}:`, "", ...lines, "", `${baseUrl}/admin/updates`].join("\n");

  // Inline styles only — every mail client strips <style> blocks.
  const html = [
    `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#111">`,
    `<h2 style="font-size:18px;margin:0 0 16px">Aktivita za ${escapeHtml(day)}</h2>`,
    ...data.galleries.map((g) => {
      const bits = summarize(g);

      return [
        `<div style="border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin-bottom:12px">`,
        `<div style="font-weight:600">${escapeHtml(g.title)}</div>`,
        `<div style="color:#666;font-size:14px;margin-top:4px">${bits.map(escapeHtml).join(" · ")}</div>`,
        g.newVisitors.length > 0
          ? `<div style="color:#666;font-size:14px;margin-top:4px">Noví: ${escapeHtml(g.newVisitors.join(", "))}</div>`
          : "",
        `</div>`,
      ].join("");
    }),
    `<a href="${escapeHtml(baseUrl)}/admin/updates" style="font-size:14px">Otevřít aktivitu</a>`,
    `</div>`,
  ].join("");

  return { subject, html, text };
}

export type DigestOutcome =
  { skipped: true; reason: "no_activity" | "already_sent" } | ({ skipped: false } & MailResult);

/** Sends the digest for one owner, or reports why it did not. */
export async function sendDigest(
  ownerId: string,
  email: string,
  now: Date,
  baseUrl: string,
): Promise<DigestOutcome> {
  const { since, until } = digestWindow(now);
  const data = await collectDigest(ownerId, since, until);

  // A daily "nothing happened" email is how a sender gets filtered.
  if (data.totalEvents === 0) return { skipped: true, reason: "no_activity" };

  // Vercel documents cron delivery as best effort: a scheduled run can be
  // delivered twice. Every other job is naturally idempotent, but a second
  // digest is visible in the recipient's inbox, so the window is CLAIMED with a
  // conditional update rather than read-then-written — two concurrent
  // invocations would both see a stale timestamp and both send.
  const { count } = await prisma.user.updateMany({
    where: {
      id: ownerId,
      OR: [{ digestSentFor: null }, { digestSentFor: { lt: since } }],
    },
    data: { digestSentFor: since },
  });
  if (count === 0) return { skipped: true, reason: "already_sent" };

  const { subject, html, text } = renderDigest(data, baseUrl);
  const result = await sendMail({ to: email, subject, html, text });

  // Release the claim if the send failed, so the next run can retry rather than
  // the day being silently lost.
  if (!result.sent) {
    await prisma.user.updateMany({
      where: { id: ownerId, digestSentFor: since },
      data: { digestSentFor: null },
    });
  }

  return { skipped: false, ...result };
}

/** One summary line per gallery, shared by the text and HTML renderers. */
function summarize(g: DigestGallery): string[] {
  return [
    `${g.views}× zobrazeno`,
    pluralize(g.uniqueViewers, FORMS.viewer),
    g.reactions > 0 && pluralize(g.reactions, FORMS.reaction),
    g.favorites > 0 && pluralize(g.favorites, FORMS.favorite),
    g.downloads > 0 && pluralize(g.downloads, FORMS.download),
  ].filter((bit): bit is string => typeof bit === "string");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
