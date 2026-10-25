import { MCP_ENDPOINT_PATH, protectedResourceMetadata } from "@/lib/mcp/oauth/config";
import { metadataRoute } from "@/lib/mcp/oauth/metadata-route";

// `/.well-known/oauth-protected-resource` and its path-suffixed form for the
// one protected resource, `/.well-known/oauth-protected-resource/api/mcp`
// (RFC 9728 §3.1). Any other suffix names a resource that does not exist.
export const dynamic = "force-dynamic";

const metadata = metadataRoute(protectedResourceMetadata);

export async function GET(
  request: Request,
  ctx: RouteContext<"/.well-known/oauth-protected-resource/[[...resource]]">,
): Promise<Response> {
  const { resource } = await ctx.params;
  const suffix = resource?.length ? `/${resource.join("/")}` : "";
  if (suffix && suffix !== MCP_ENDPOINT_PATH) return new Response(null, { status: 404 });
  return metadata.GET(request);
}

export const { OPTIONS } = metadata;
