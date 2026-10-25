import { NextResponse } from "next/server";
import { publicOrigin } from "./config";

const METADATA_MAX_AGE_S = 300;

/** A public, cacheable discovery document (RFC 8414 / RFC 9728) for any origin to read. */
export function metadataRoute(build: (origin: string) => object) {
  return {
    GET: (request: Request) =>
      NextResponse.json(build(publicOrigin(request.headers)), {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": `public, max-age=${METADATA_MAX_AGE_S}`,
        },
      }),
    OPTIONS: () =>
      new Response(null, {
        status: 204,
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" },
      }),
  };
}
