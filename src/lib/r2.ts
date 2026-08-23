import "server-only";
import { AwsClient } from "aws4fetch";
import { serverEnv } from "@/lib/env";

// Photos are immutable per object key, so variants stay hot in Cloudflare's
// edge cache and origin reads to R2 stay rare (docs/PLAN.md §6).
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Presigned URLs are bearer tokens — keep the window short. */
const PRESIGN_EXPIRY_SECONDS = 900;

let cachedClient: AwsClient | undefined;

function r2Client(): AwsClient {
  if (cachedClient) return cachedClient;
  const env = serverEnv();
  cachedClient = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    // R2 only accepts "auto"; the local MinIO stand-in (compose.yaml) wants a
    // real region name, so this is configurable rather than hardcoded.
    region: env.S3_REGION,
  });
  return cachedClient;
}

// Path-style addressing (`{endpoint}/{bucket}/{key}`) — supported by R2 and
// required by MinIO in its default single-host setup.
function objectUrl(key: string): string {
  const env = serverEnv();
  // Each path segment is encoded separately so "/" in the key stays a separator.
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${env.R2_ENDPOINT.replace(/\/$/, "")}/${env.R2_BUCKET}/${encodedKey}`;
}

/**
 * Presign a single-object PUT. 12MB JPEGs are far below R2's 5 GiB single-PUT
 * limit, so multipart is never needed.
 *
 * `Content-Type` and `Cache-Control` are signed into the URL, which means the
 * browser MUST send byte-identical values or R2 rejects the request with 403.
 * The bucket CORS policy must allow both headers.
 */
export async function presignPut(key: string, contentType: string): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRY_SECONDS));

  const signed = await r2Client().sign(
    new Request(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Cache-Control": IMMUTABLE_CACHE_CONTROL,
      },
    }),
    { aws: { signQuery: true } },
  );

  return signed.url;
}

/** Headers the browser must send with the presigned PUT, verbatim. */
export function presignedPutHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
  };
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  lastModified: Date;
}

/**
 * ListObjectsV2 over a prefix, following continuation tokens.
 *
 * S3 caps a page at 1000 keys, so a full year of galleries needs several
 * round trips; the caller gets everything or an error, never a silent
 * truncation — a partial listing would make the orphan sweep delete live
 * objects it simply had not seen.
 */
export async function listObjects(prefix: string): Promise<StoredObject[]> {
  const env = serverEnv();
  const base = `${env.R2_ENDPOINT.replace(/\/$/, "")}/${env.R2_BUCKET}`;
  const objects: StoredObject[] = [];
  let continuationToken: string | undefined;

  do {
    const url = new URL(base);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (continuationToken) url.searchParams.set("continuation-token", continuationToken);

    const response = await r2Client().fetch(url.toString(), { method: "GET" });
    if (!response.ok) {
      throw new Error(`ListObjectsV2 failed for "${prefix}": ${response.status}`);
    }

    const xml = await response.text();
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = match[1] ?? "";
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      if (!key) continue;
      objects.push({
        key: decodeXmlText(key),
        sizeBytes: Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        lastModified: new Date(block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? 0),
      });
    }

    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    continuationToken = truncated
      ? decodeXmlText(
          xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "",
        )
      : undefined;

    // A truncated page with no token would loop forever.
    if (truncated && !continuationToken) {
      throw new Error(`ListObjectsV2 truncated without a continuation token for "${prefix}"`);
    }
  } while (continuationToken);

  return objects;
}

/** S3 escapes these five in element text; keys legitimately contain them. */
function decodeXmlText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Delete an object (gallery cleanup / reconciliation of orphans). */
export async function deleteObject(key: string): Promise<void> {
  const response = await r2Client().fetch(objectUrl(key), { method: "DELETE" });
  // R2 returns 204 for a successful delete and 404 if it was already gone.
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed for ${key}: ${response.status}`);
  }
}

/**
 * The actual byte count R2 holds for a key, from `Content-Length` on a HEAD —
 * ground truth against a client's declared `sizeBytes` at confirm
 * (docs/GUEST-GALLERIES.md §15). `null` when the object is not there at all,
 * which a caller should treat the same as a mismatch.
 */
export async function headObject(key: string): Promise<{ sizeBytes: number } | null> {
  const response = await r2Client().fetch(objectUrl(key), { method: "HEAD" });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`R2 head failed for ${key}: ${response.status}`);
  }
  const contentLength = response.headers.get("content-length");
  return { sizeBytes: contentLength ? Number(contentLength) : 0 };
}
