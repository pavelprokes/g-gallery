import { archiveSize, zipStream, type ZipEntry } from "../../src/lib/zip64";
import { verifyManifest } from "../../src/lib/zip-manifest";
import { keyInGrant, verifyImageAccess } from "../../src/lib/image-signing";
import { ALL_WIDTHS, QUALITY } from "../../src/lib/image-sizes";

/**
 * Streams a gallery as a ZIP, straight out of R2, and — once this Worker is
 * put in front of the image path (docs/PLAN.md §4.1 "v2 hardening") —
 * proxies signed image requests to the zone's Image Transformations.
 *
 * This exists because the archive must never pass through Vercel: a function
 * there is billed for data transfer and for provisioned memory across the whole
 * download, and would be killed at maxDuration long before 8 GB finished
 * (CLAUDE.md invariant #1, docs/PLAN.md §7). A Worker holding an HTTP response
 * open has no wall-clock limit and reads R2 at zero egress.
 *
 * It holds no session and talks to no database. All it trusts is an HMAC-signed
 * manifest or grant minted by the app, which is where the share link, its
 * expiry and its password were actually checked.
 */

interface Env {
  PHOTOS: R2Bucket;
  ZIP_SIGNING_SECRET: string;
  /** Origin allowed to submit the form, e.g. https://photos.svatebni-fotograf-cechy.cz */
  APP_ORIGIN: string;
  /** Secret shared with `IMAGE_SIGNING_SECRET` in the app (src/lib/image-signing.ts). */
  IMAGE_SIGNING_SECRET: string;
  /** The zone hostname Image Transformations run on, e.g. photos.svatebni-fotograf-cechy.cz —
   * this Worker proxies to it rather than resizing itself. */
  PHOTOS_ZONE_HOST: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.startsWith("/img/")) {
      return handleSignedImage(url, env);
    }

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

    // One photo is served as that photo, not as a one-entry archive. This is
    // also what fixes per-photo download: the browser ignores the `download`
    // attribute cross-origin, so a plain link to R2 merely displays a 24 MB
    // JPEG. Content-Disposition is the only thing that actually saves a file.
    if (manifestEntries.length === 1) {
      const only = manifestEntries[0]!;
      const object = await env.PHOTOS.get(only.key);
      if (!object) return new Response("Object not found", { status: 404 });

      return new Response(object.body, {
        headers: {
          // R2 has the type because the presigned PUT signs it, but falling
          // back to the extension keeps this correct for objects that arrived
          // any other way.
          "Content-Type": object.httpMetadata?.contentType ?? typeFromName(only.name),
          "Content-Length": String(object.size),
          "Content-Disposition": dispositionFor(only.name),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
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
        "Content-Disposition": dispositionFor(archiveName),
        // The manifest is single-use in spirit and short-lived; never cache.
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * `GET /img/{key}?w=&q=&sig=&exp=` — verifies the grant, then proxies to the
 * zone's own Image Transformations rather than resizing here. `exp` in the
 * query is informational only (a fresh cache key when a grant is renewed);
 * the only trustworthy expiry is the one inside the verified `sig` token.
 */
async function handleSignedImage(url: URL, env: Env): Promise<Response> {
  const key = decodeURIComponent(url.pathname.slice("/img/".length));
  const sig = url.searchParams.get("sig");
  const width = Number(url.searchParams.get("w"));
  const quality = Number(url.searchParams.get("q"));

  if (!key || !sig) return new Response("Missing key or signature", { status: 400 });

  const verified = await verifyImageAccess(sig, env.IMAGE_SIGNING_SECRET);
  if (!verified.ok) {
    // 410 for an expired grant, matching the ZIP manifest's convention: the
    // client should ask the app for a fresh one, not treat the link as dead.
    return new Response(verified.reason, { status: verified.reason === "expired" ? 410 : 403 });
  }
  if (!keyInGrant(key, verified.grant)) {
    return new Response("Key outside grant", { status: 403 });
  }

  // Variant-parameter abuse (docs/PLAN.md §4.2): only the widths and quality
  // the app itself ever requests are allowed, regardless of what a viewer's
  // browser DevTools could otherwise ask this endpoint for.
  if (!ALL_WIDTHS.includes(width as (typeof ALL_WIDTHS)[number])) {
    return new Response("Width not allowed", { status: 400 });
  }
  if (quality !== QUALITY) return new Response("Quality not allowed", { status: 400 });

  const transformUrl = `https://${env.PHOTOS_ZONE_HOST}/cdn-cgi/image/width=${width},quality=${quality},format=auto,fit=scale-down/${key}`;
  const upstream = await fetch(transformUrl, { cf: { cacheEverything: true } });

  // A new Response so the upstream's own headers (some of which came from
  // R2/cdn-cgi and aren't meant for the browser) don't leak through verbatim.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

function typeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/** RFC 5987: an ASCII fallback plus the real UTF-8 name for clients that read it. */
function dispositionFor(name: string): string {
  return `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

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
