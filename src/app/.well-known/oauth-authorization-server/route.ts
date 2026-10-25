import { authorizationServerMetadata } from "@/lib/mcp/oauth/config";
import { metadataRoute } from "@/lib/mcp/oauth/metadata-route";

export const dynamic = "force-dynamic";

export const { GET, OPTIONS } = metadataRoute(authorizationServerMetadata);
