import { archiveSize, zipStream, type ZipEntry } from "../../src/lib/zip64";
import { verifyManifest } from "../../src/lib/zip-manifest";

/**
 * Streams a gallery as a ZIP, straight out of R2.
 *
 * This exists because the archive must never pass through Vercel: a function
 * there is billed for data transfer and for provisioned memory across the whole
 * download, and would be killed at maxDuration long before 8 GB finished
 * (CLAUDE.md invariant #1, docs/PLAN.md §7). A Worker holding an HTTP response
 * open has no wall-clock limit and reads R2 at zero egress.
 *
 * It holds no session and talks to no database. All it trusts is an HMAC-signed
 * manifest minted by the app, which is where the share link, its expiry and its
 * password were actually checked.
 */

interface Env {
  PHOTOS: R2Bucket;
  ZIP_SIGNING_SECRET: string;
  /** Origin allowed to submit the form, e.g. https://svatebni-fotograf-cechy.cz */
  APP_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }

    // The form is submitted by a page on the app's own origin. This is not the
    // security boundary — the signature is — but it keeps other sites from
    // using the Worker as a download proxy for links they scraped.
    const origin = request.headers.get("origin");
    if (origin && origin !== env.APP_ORIGIN) {
      return new Response("Forbidden origin", { status: 403 });
    }

    let token: string | null;
    try {
      token = (await request.formData()).get("manifest") as string | null;
    } catch {
      return new Response("Malformed request", { status: 400 });
    }
    if (!token) return new Response("Missing manifest", { status: 400 });

    const verified = await verifyManifest(token, env.ZIP_SIGNING_SECRET);
    if (!verified.ok) {
      // 410 for an expired manifest: the browser should ask the app for a new
      // one rather than treat the link as permanently broken.
      const status = verified.reason === "expired" ? 410 : 403;
      return new Response(verified.reason, { status });
    }

    const { entries: manifestEntries, archiveName } = verified.manifest;

    const entries: ZipEntry[] = manifestEntries.map((entry) => ({
      name: entry.name,
      size: entry.size,
      // A missing CRC would produce an archive every extractor rejects, so it
      // is caught here rather than 8 GB later.
      crc32: Number.parseInt(entry.crc32 ?? "", 16) >>> 0,
    }));

    const missing = manifestEntries.findIndex((entry) => !entry.crc32 || !entry.size);
    if (missing >= 0) {
      return new Response(`Entry ${manifestEntries[missing]!.name} has no checksum or size`, {
        status: 409,
      });
    }

    const stream = zipStream(entries, async (index) => {
      const key = manifestEntries[index]!.key;
      const object = await env.PHOTOS.get(key);
      if (!object) throw new Error(`missing object: ${key}`);
      return object.body;
    });

    // A plain `new Response(stream)` is sent chunked and the runtime discards
    // any Content-Length set by hand — verified against wrangler. FixedLengthStream
    // is the documented way to declare the length up front, and it also makes the
    // runtime abort the response if the body does not match, which turns a
    // silent truncation into a visible failure.
    const total = archiveSize(entries);
    const fixed = new FixedLengthStream(total);
    // Not awaited: the response must start flowing immediately, and awaiting
    // pipeTo would mean buffering the whole archive first.
    void stream.pipeTo(fixed.writable).catch(() => {
      // The viewer cancelled, or an object vanished mid-stream. Either way the
      // download is already doomed; nothing useful can be sent at this point.
    });

    return new Response(fixed.readable, {
      headers: {
        "Content-Type": "application/zip",
        // Exact, because sizes and CRCs were known before a byte was read.
        // Without it the browser shows an indeterminate spinner for 8 GB and
        // cannot tell a finished download from a truncated one.
        "Content-Length": String(total),
        "Content-Disposition": `attachment; filename="${asciiName(archiveName)}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
        // The manifest is single-use in spirit and short-lived; never cache.
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
} satisfies ExportedHandler<Env>;

/** Fallback for clients that ignore RFC 5987's filename*. */
function asciiName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w.\-]+/g, "_")
      .slice(0, 100) || "galerie.zip"
  );
}
