import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * The MCP endpoint for Claude (docs/MCP.md), against the production build and
 * the seeded database. Tools are called with the development token the
 * Playwright config sets (`MCP_DEV_TOKEN`, acting as the E2E admin); the OAuth
 * exchange with Claude's clients is covered by src/lib/mcp/oauth/oauth.test.ts,
 * since it would need claude.ai's client documents from the network; a
 * registered client (Paperclip) goes through the whole flow here.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  galleryId: string;
  token: string;
  slug: string;
  photoCount: number;
  weddingId: string;
};

const DEV_TOKEN = process.env.MCP_DEV_TOKEN!;

// API-level: one browser project is enough, and the write flow would
// otherwise run twice against the same data.
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "API spec");

let nextId = 1;

async function rpc(
  request: APIRequestContext,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${DEV_TOKEN}`, "MCP-Protocol-Version": "2025-11-25" },
    data: { jsonrpc: "2.0", id: nextId++, method, params },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { result?: Record<string, unknown>; error?: { code: number } };
}

async function tool<T = Record<string, unknown>>(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { result } = await rpc(request, "tools/call", { name, arguments: args });
  expect(result?.isError, JSON.stringify(result?.content)).toBeFalsy();
  return result!.structuredContent as T;
}

test.describe("transport and discovery", () => {
  test("challenges a caller without a token toward OAuth discovery", async ({ request }) => {
    const response = await request.post("/api/mcp", {
      data: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toContain(
      'resource_metadata="http://127.0.0.1:3000/.well-known/oauth-protected-resource/api/mcp"',
    );

    const resource = await request.get("/.well-known/oauth-protected-resource/api/mcp");
    expect(await resource.json()).toMatchObject({
      resource: "http://127.0.0.1:3000/api/mcp",
      authorization_servers: ["http://127.0.0.1:3000"],
    });
    const server = await request.get("/.well-known/oauth-authorization-server");
    expect(await server.json()).toMatchObject({
      authorization_endpoint: "http://127.0.0.1:3000/oauth/authorize",
      client_id_metadata_document_supported: true,
      registration_endpoint: "http://127.0.0.1:3000/api/oauth/register",
    });
    expect((await request.get("/.well-known/oauth-protected-resource/elsewhere")).status()).toBe(
      404,
    );
  });

  test("refuses GET, foreign origins and a bad token", async ({ request }) => {
    expect((await request.get("/api/mcp")).status()).toBe(405);
    const foreign = await request.post("/api/mcp", {
      headers: { Authorization: `Bearer ${DEV_TOKEN}`, Origin: "https://evil.example" },
      data: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(foreign.status()).toBe(403);
    const wrong = await request.post("/api/mcp", {
      headers: { Authorization: "Bearer gga_not-a-real-token" },
      data: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(wrong.status()).toBe(401);
    expect(wrong.headers()["www-authenticate"]).toContain('error="invalid_token"');
  });

  test("speaks both protocol eras", async ({ request }) => {
    const init = await rpc(request, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
    });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "g-gallery" },
    });

    const list = await rpc(request, "tools/list");
    const names = (list.result!.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["galleries_list", "photo_get", "gallery_create"]),
    );

    const discover = await request.post("/api/mcp", {
      headers: {
        Authorization: `Bearer ${DEV_TOKEN}`,
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "server/discover",
      },
      data: {
        jsonrpc: "2.0",
        id: 99,
        method: "server/discover",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
      },
    });
    expect(await discover.json()).toMatchObject({ result: { resultType: "complete" } });
  });
});

test.describe("reading", () => {
  test("lists, details and counts the seeded gallery", async ({ request }) => {
    const overview = await tool<{ galleries: { PUBLISHED: number }; weddings: number }>(
      request,
      "overview",
    );
    expect(overview.galleries.PUBLISHED).toBeGreaterThan(0);
    expect(overview.weddings).toBeGreaterThan(0);

    const list = await tool<{ galleries: { id: string; guestUrl: string | null }[] }>(
      request,
      "galleries_list",
      {
        query: "E2E Test Gallery",
        limit: 50,
      },
    );
    const listed = list.galleries.find((gallery) => gallery.id === seed.galleryId);
    expect(listed?.guestUrl).toBe(`http://127.0.0.1:3000/g/${seed.token}/${seed.slug}`);

    const detail = await tool<{
      counts: { photos: number };
      shareLinks: { url: string; live: boolean }[];
    }>(request, "gallery_get", { gallery_id: seed.galleryId });
    expect(detail.counts.photos).toBe(seed.photoCount);
    expect(detail.shareLinks[0]).toMatchObject({ live: true, url: listed?.guestUrl });

    const stats = await tool<{ allTime: object; period: { perDay: unknown[] } }>(
      request,
      "gallery_stats",
      {
        gallery_id: seed.galleryId,
        days: 7,
      },
    );
    expect(stats.period.perDay).toHaveLength(7);
  });

  test("pages photos in the gallery's order with CDN addresses", async ({ request }) => {
    const first = await tool<{
      total: number;
      photos: { id: string; fileName: string; originalUrl: string }[];
    }>(request, "photos_list", { gallery_id: seed.galleryId, limit: 5 });
    expect(first.total).toBe(seed.photoCount);
    expect(first.photos.map((photo) => photo.fileName)).toEqual([
      "e2e_0000.jpg",
      "e2e_0001.jpg",
      "e2e_0002.jpg",
      "e2e_0003.jpg",
      "e2e_0004.jpg",
    ]);
    const compact = await tool<{ photos: Record<string, unknown>[] }>(request, "photos_list", {
      gallery_id: seed.galleryId,
      compact: true,
      offset: 5,
      limit: 60,
    });
    expect(compact.photos).toHaveLength(seed.photoCount - 5);
    expect(Object.keys(compact.photos[0]!).sort()).toEqual([
      "fileName",
      "id",
      "originalUrl",
      "previewUrl",
      "thumbUrl",
    ]);

    const photo = await tool<{ fileName: string; originalUrl: string; downloadUrl: string }>(
      request,
      "photo_get",
      {
        photo_id: first.photos[0]!.id,
      },
    );
    expect(photo.fileName).toBe("e2e_0000.jpg");
    expect(photo.originalUrl).toMatch(/\/photo-0\.jpg$/);
    expect(photo.downloadUrl).toContain("X-Amz-Signature=");
  });

  test("reads weddings, activity, corrections and the print order", async ({ request }) => {
    const weddings = await tool<{ weddings: { id: string }[] }>(request, "weddings_list", {
      limit: 50,
    });
    expect(weddings.weddings.map((wedding) => wedding.id)).toContain(seed.weddingId);
    const wedding = await tool<{ title: string; galleries: { visibleToGuests: boolean }[] }>(
      request,
      "wedding_get",
      { wedding_id: seed.weddingId },
    );
    expect(wedding.title).toBe("Pavel a Patricie");
    expect(wedding.galleries.some((gallery) => gallery.visibleToGuests)).toBe(true);

    await tool(request, "activity_recent", { days: 395 });
    await tool(request, "corrections_list", { status: "all" });
    const prints = await tool<{ items: unknown[] }>(request, "print_order_get", {
      gallery_id: seed.galleryId,
    });
    expect(Array.isArray(prints.items)).toBe(true);
  });

  test("explains a bad id or bad arguments instead of failing", async ({ request }) => {
    const missing = await rpc(request, "tools/call", {
      name: "gallery_get",
      arguments: { gallery_id: "nope" },
    });
    expect(missing.result).toMatchObject({ isError: true });
    expect(JSON.stringify(missing.result)).toContain("Galerie nenalezena");

    const bad = await rpc(request, "tools/call", {
      name: "gallery_create",
      arguments: { title: "" },
    });
    expect(bad.result).toMatchObject({ isError: true });
  });
});

test.describe("creating", () => {
  test("a gallery goes from draft to a link a guest can open, and back", async ({
    request,
    page,
  }) => {
    const created = await tool<{ id: string; status: string }>(request, "gallery_create", {
      title: "MCP Předání",
      event_date: "2026-09-12",
    });
    expect(created.status).toBe("DRAFT");

    const link = await tool<{ id: string; url: string; allowDownload: boolean }>(
      request,
      "share_link_create",
      {
        gallery_id: created.id,
        label: "Pro pár",
      },
    );
    expect(link.url).toMatch(/\/g\/[\w-]+\/mcp-predani-2026-09-12$/);
    expect(link.allowDownload).toBe(true);

    expect((await page.goto(link.url))?.status()).toBe(404);
    await tool(request, "gallery_publish", { gallery_id: created.id });
    await page.goto(link.url);
    await expect(page.getByRole("heading", { name: "MCP Předání" })).toBeVisible();

    await tool(request, "gallery_update", { gallery_id: created.id, description: "Jen pro admin" });
    const changed = await tool<{ allowDownload: boolean; allowReactions: boolean }>(
      request,
      "share_link_set_permissions",
      { share_link_id: link.id, allow_download: false },
    );
    expect(changed).toMatchObject({ allowDownload: false, allowReactions: true });

    await tool(request, "gallery_unpublish", { gallery_id: created.id });
    expect((await page.goto(link.url))?.status()).toBe(404);
  });

  test("a wedding with a gallery shows its card once listed", async ({ request, page }) => {
    const wedding = await tool<{ id: string; guestUrl: string }>(request, "wedding_create", {
      title: "MCP Svatba",
      venue: "Zámek Loučeň",
    });
    const gallery = await tool<{ id: string; listedOnWeddingPage: boolean }>(
      request,
      "gallery_create",
      {
        title: "MCP Obřad",
        wedding_id: wedding.id,
      },
    );
    expect(gallery.listedOnWeddingPage).toBe(false);

    await page.goto(wedding.guestUrl);
    await expect(page.getByRole("heading", { name: "MCP Svatba" })).toBeVisible();
    await expect(page.getByRole("link", { name: /MCP Obřad/ })).toHaveCount(0);

    await tool(request, "wedding_set_gallery_listed", { gallery_id: gallery.id, listed: true });
    const detail = await tool<{ galleries: { id: string; visibleToGuests: boolean }[] }>(
      request,
      "wedding_get",
      {
        wedding_id: wedding.id,
      },
    );
    expect(detail.galleries).toEqual([
      expect.objectContaining({ id: gallery.id, visibleToGuests: true }),
    ]);
    // A wedding page with a single card opens that gallery straight away.
    await page.reload();
    await expect(page.getByRole("heading", { name: "MCP Obřad", level: 1 })).toBeVisible();

    const renamed = await tool<{ title: string; venue: string }>(request, "wedding_update", {
      wedding_id: wedding.id,
      title: "MCP Svatba 2",
    });
    expect(renamed).toMatchObject({ title: "MCP Svatba 2", venue: "Zámek Loučeň" });
  });

  test("an existing gallery joins a wedding hidden, and says why it is not shown yet", async ({
    request,
  }) => {
    const wedding = await tool<{ id: string }>(request, "wedding_create", { title: "MCP Druhá" });
    const gallery = await tool<{ id: string }>(request, "gallery_create", { title: "MCP Hostina" });
    const link = await tool<{ id: string }>(request, "share_link_create", {
      gallery_id: gallery.id,
    });

    await tool(request, "wedding_add_gallery", {
      wedding_id: wedding.id,
      gallery_id: gallery.id,
      card_share_link_id: link.id,
    });
    const attached = await tool<{ galleries: { listedOnWeddingPage: boolean }[] }>(
      request,
      "wedding_get",
      { wedding_id: wedding.id },
    );
    expect(attached.galleries).toEqual([expect.objectContaining({ listedOnWeddingPage: false })]);

    const draft = await tool<{ visibleToGuests: boolean; hiddenBecause: string[] }>(
      request,
      "wedding_set_gallery_listed",
      { gallery_id: gallery.id, listed: true },
    );
    expect(draft.visibleToGuests).toBe(false);
    expect(draft.hiddenBecause).toEqual([expect.stringContaining("není zveřejněná")]);

    await tool(request, "gallery_publish", { gallery_id: gallery.id });
    const shown = await tool<{ visibleToGuests: boolean }>(request, "wedding_set_gallery_listed", {
      gallery_id: gallery.id,
      listed: true,
    });
    expect(shown.visibleToGuests).toBe(true);
  });

  test("refuses an impossible date instead of shifting it", async ({ request }) => {
    const { result } = await rpc(request, "tools/call", {
      name: "wedding_create",
      arguments: { title: "MCP Únor", event_date: "2026-02-30" },
    });
    expect(result).toMatchObject({ isError: true });
  });
});

test.describe("consent page", () => {
  test("sends a stranger to sign in, coming back to the same request", async ({ page }) => {
    await page.goto("/oauth/authorize?client_id=x&response_type=code");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Foauth%2Fauthorize%3Fclient_id%3Dx/);
  });

  test("refuses a client that is not Claude, without redirecting anywhere", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
    await page.goto(
      "/oauth/authorize?client_id=https%3A%2F%2Fevil.example%2Fclient&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&response_type=code",
    );
    await expect(page.getByRole("heading", { name: "Připojení se nepovedlo" })).toBeVisible();
    await expect(page.getByText(/Neznámý klient/)).toBeVisible();
    expect(new URL(page.url()).host).toBe(new URL(baseURL!).host);
  });

  test("cannot be framed by another site", async ({ request }) => {
    const response = await request.get("/oauth/authorize", { maxRedirects: 0 });
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});

test.describe("registered client", () => {
  const CALLBACK = "https://paperclip.example.test/oauth/callback";
  const VERIFIER = "e2e-verifier-".padEnd(64, "v");

  test("registers only on an allowed origin", async ({ request }) => {
    const refused = await request.post("/api/oauth/register", {
      data: { client_name: "Evil", redirect_uris: ["https://evil.example/cb"] },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });

  test("signs in with the photographer's account and calls a tool", async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const registered = await request.post("/api/oauth/register", {
      data: { client_name: "Paperclip", redirect_uris: [CALLBACK] },
    });
    expect(registered.status()).toBe(201);
    const { client_id: clientId } = (await registered.json()) as { client_id: string };

    const challenge = crypto.createHash("sha256").update(VERIFIER).digest("base64url");
    const authorize = new URLSearchParams({
      client_id: clientId,
      redirect_uri: CALLBACK,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "e2e-state",
      resource: `${baseURL}/api/mcp`,
    });
    let returned: URL | null = null;
    await page.route("https://paperclip.example.test/**", async (route) => {
      returned = new URL(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
    });
    await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
    await page.goto(`/oauth/authorize?${authorize.toString()}`);
    await expect(page.getByRole("heading", { name: "Připojit Paperclip" })).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: "paperclip.example.test" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Povolit přístup" }).click();
    await expect.poll(() => returned?.searchParams.get("state")).toBe("e2e-state");
    const code = returned!.searchParams.get("code")!;

    const tokens = await request.post("/api/oauth/token", {
      form: {
        grant_type: "authorization_code",
        code,
        code_verifier: VERIFIER,
        client_id: clientId,
        redirect_uri: CALLBACK,
      },
    });
    expect(tokens.status()).toBe(200);
    const { access_token: accessToken } = (await tokens.json()) as { access_token: string };
    const call = await request.post("/api/mcp", {
      headers: { Authorization: `Bearer ${accessToken}`, "MCP-Protocol-Version": "2025-11-25" },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "overview", arguments: {} },
      },
    });
    expect(call.status()).toBe(200);
    expect(((await call.json()) as { result: { isError?: boolean } }).result.isError).toBeFalsy();
  });
});
