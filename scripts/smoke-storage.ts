/**
 * End-to-end check of the storage + delivery path against whatever the loaded
 * env points at — the Docker stack locally, R2 + Cloudflare in production.
 *
 *   pnpm smoke:storage
 *
 * Run it after changing bucket credentials, CORS, or the delivery host: it
 * fails loudly on the mistakes that are otherwise only visible in the browser
 * (unsigned headers, missing CORS, a transform host that can't reach the bucket).
 */
import "dotenv/config";
import imageLoader from "../src/lib/image-loader";
import { deleteObject, presignPut, presignedPutHeaders } from "../src/lib/r2";

// A 2x2 JPEG is enough to prove the whole path; the transform step only needs
// a decodable image, not a realistic one.
const JPEG_2X2 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

const KEY = `smoke/storage-check-${process.pid}.jpg`;

function report(label: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label.padEnd(28)} ${detail}`);
  return ok;
}

async function main() {
  const results: boolean[] = [];
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  if (!endpoint || !bucket) {
    throw new Error("R2_ENDPOINT and R2_BUCKET must be set");
  }

  const signed = await presignPut(KEY, "image/jpeg");
  results.push(
    report("presign", signed.includes("X-Amz-Signature"), signed.slice(0, signed.indexOf("?"))),
  );

  const put = await fetch(signed, {
    method: "PUT",
    headers: presignedPutHeaders("image/jpeg"),
    body: JPEG_2X2,
  });
  results.push(
    report("presigned PUT", put.ok, `${put.status} etag=${put.headers.get("etag") ?? "-"}`),
  );
  if (!put.ok) {
    console.error(await put.text());
    process.exit(1);
  }

  // Public read is what the gallery relies on: image bytes must never be
  // proxied through the app (CLAUDE.md invariant #1).
  const origin = `${endpoint.replace(/\/$/, "")}/${bucket}/${KEY}`;
  const get = await fetch(origin);
  results.push(
    report(
      "public GET",
      get.ok,
      `${get.status} ${get.headers.get("content-type")} cache-control=${get.headers.get("cache-control")}`,
    ),
  );

  // The transform URL is built by the same loader the app uses, so a broken
  // NEXT_PUBLIC_* combination shows up here rather than as a broken <img>.
  const transformed = imageLoader({ src: KEY, width: 640, quality: 82 });
  if (transformed === `/${KEY}?w=640`) {
    report("transform", true, "skipped — no NEXT_PUBLIC_PHOTOS_BASE_URL set");
  } else {
    const res = await fetch(transformed, {
      headers: { Accept: "image/avif,image/webp,image/*" },
    });
    results.push(
      report(
        "transform",
        res.ok,
        `${res.status} ${res.headers.get("content-type")} via ${new URL(transformed).host}`,
      ),
    );
  }

  await deleteObject(KEY);
  const gone = await fetch(origin);
  results.push(report("delete", gone.status === 404, `object now ${gone.status}`));

  if (results.includes(false)) process.exit(1);
  console.log("\nstorage path OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
