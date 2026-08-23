import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The guest-upload path (docs/GUEST-GALLERIES.md §6), end to end against a
 * real production build and the local MinIO standing in for R2: file picker →
 * presign → PUT straight to storage → confirm → the photo appears in the grid.
 *
 * Worth covering here rather than in unit tests because every interesting
 * failure lives between the parts — a mismatched signed header, a CORS refusal
 * on the PUT, a confirm that authorises differently from the presign. Unlike
 * the admin upload flow (docs/TODO.md §0) this needs no signed-in session, so
 * it is coverable today without a test-auth bypass.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  uploadToken: string;
  uploadSlug: string;
  readOnlyToken: string;
  /** One wedding per browser project — see e2e/seed.ts for why. */
  selfDelete: Record<string, { token: string; slug: string }>;
};

/** The self-delete wedding belonging to the project running this test. */
function selfDeleteUrl(projectName: string): string {
  const wedding = seed.selfDelete[projectName];
  if (!wedding) throw new Error(`no self-delete wedding seeded for project ${projectName}`);
  return `/s/${wedding.token}/${wedding.slug}`;
}

/** A real, decodable 1×1 JPEG: the client strips EXIF, CRC32s and decodes it. */
const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
);

function tileCount(page: Page): Promise<number> {
  return page
    .getByRole("list", { name: "Fotky v galerii" })
    .locator('button[aria-label^="Otevřít"]')
    .count();
}

test.describe("guest uploads", () => {
  test("a link with allowUpload adds a photo the grid then shows", async ({ page }) => {
    await page.goto(`/g/${seed.uploadToken}/${seed.uploadSlug}`);

    const addButton = page.getByRole("button", { name: "Přidat fotky" });
    await expect(addButton).toBeVisible();

    const before = await tileCount(page);

    // The picker input is hidden behind the button by design; drive it
    // directly rather than opening a native file dialog.
    await page.locator('input[type="file"]:not([capture])').setInputFiles({
      name: "svatba.jpg",
      mimeType: "image/jpeg",
      buffer: ONE_PIXEL_JPEG,
    });

    await expect(page.getByText("Nahráno. Uvidí to všichni na svatbě.")).toBeVisible({
      timeout: 30_000,
    });

    // Asked only after a photo actually landed — never before the upload.
    await expect(page.getByText("Komu za ně poděkovat?")).toBeVisible();
    await page.getByRole("button", { name: "Přeskočit" }).click();
    await expect(page.getByText("Komu za ně poděkovat?")).toBeHidden();

    // Greater-than, not exactly one more: both browser projects upload into
    // this same gallery in parallel, so an exact count is a race, not a fact.
    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBeGreaterThan(before);
  });

  test("a guest can take back a photo they uploaded, and only that one", async ({
    page,
  }, testInfo) => {
    await page.goto(selfDeleteUrl(testInfo.project.name));

    // Wait for the seeded photos to render before counting. Reading the count
    // straight after goto() catches an empty grid and turns every later
    // assertion into a race — which is exactly how this test first failed.
    const SEEDED = 2;
    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBe(SEEDED);

    await page.locator('input[type="file"]:not([capture])').setInputFiles({
      name: "omylem.jpg",
      mimeType: "image/jpeg",
      buffer: ONE_PIXEL_JPEG,
    });
    await expect(page.getByText("Nahráno. Uvidí to všichni na svatbě.")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Přeskočit" }).click();
    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBe(SEEDED + 1);

    // Newest first, so the photo just uploaded is the first tile.
    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await grid.locator('button[aria-label^="Otevřít"]').first().click();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Smazat mou fotku" }).click();

    // Back to the seeded photos: the guest's own upload is gone, the two that
    // were never theirs are untouched.
    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBe(SEEDED);
  });

  test("a photo someone else uploaded offers no delete button", async ({ page }, testInfo) => {
    // A fresh browser context has its own anonKey, so the seeded photos in this
    // gallery belong to nobody it knows — exactly the state of a guest looking
    // at somebody else's shot.
    await page.goto(selfDeleteUrl(testInfo.project.name));

    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await expect
      .poll(() => grid.locator('button[aria-label^="Otevřít"]').count())
      .toBeGreaterThan(0);
    await grid.locator('button[aria-label^="Otevřít"]').last().click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Smazat mou fotku" })).toHaveCount(0);
  });

  test("a read-only link to the same gallery offers no way to upload", async ({ page }) => {
    await page.goto(`/g/${seed.readOnlyToken}/${seed.uploadSlug}`);

    // Asserting on the title rather than the grid: this gallery may still be
    // empty depending on worker order, and an empty grid renders zero-height.
    await expect(page).toHaveTitle(/E2E Guest Gallery/);
    await expect(page.getByRole("button", { name: "Přidat fotky" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Vyfotit" })).toHaveCount(0);
  });

  test("the server refuses an upload through a read-only link, not just the UI", async ({
    request,
  }) => {
    const response = await request.post("/api/uploads/presign", {
      data: {
        shareToken: seed.readOnlyToken,
        anonKey: "00000000-0000-4000-8000-000000000000",
        files: [{ fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 1000 }],
      },
    });

    expect(response.status()).toBe(403);
    expect((await response.json()).reason).toBe("UPLOAD_NOT_ALLOWED");
  });

  test("HEIC is refused with an instruction, not a generic error", async ({ request }) => {
    const response = await request.post("/api/uploads/presign", {
      data: {
        shareToken: seed.uploadToken,
        anonKey: "00000000-0000-4000-8000-000000000001",
        files: [{ fileName: "IMG_0001.HEIC", contentType: "image/heic", sizeBytes: 2_000_000 }],
      },
    });

    expect(response.status()).toBe(415);
    const body = await response.json();
    expect(body.error).toBe("unsupported_type");
    expect(body.reason).toBe("heic");
  });
});
