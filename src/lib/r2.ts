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
    region: "auto",
  });
  return cachedClient;
}

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

/** Delete an object (gallery cleanup / reconciliation of orphans). */
export async function deleteObject(key: string): Promise<void> {
  const response = await r2Client().fetch(objectUrl(key), { method: "DELETE" });
  // R2 returns 204 for a successful delete and 404 if it was already gone.
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed for ${key}: ${response.status}`);
  }
}
