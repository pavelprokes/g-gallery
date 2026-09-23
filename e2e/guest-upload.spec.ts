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
  /** Empty upload galleries per browser project, for the name sheet. */
  naming: Record<string, Record<"first" | "second" | "skip", { token: string; slug: string }>>;
};

function namingUrl(projectName: string, which: "first" | "second" | "skip"): string {
  const link = seed.naming[projectName]?.[which];
  if (!link) throw new Error(`no naming gallery seeded for project ${projectName}`);
  return `/g/${link.token}/${link.slug}`;
}

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

const JPEG = (name: string) => ({ name, mimeType: "image/jpeg", buffer: ONE_PIXEL_JPEG });

/**
 * A first-time guest: "Přidat fotky" opens the name sheet, and the sheet's
 * buttons are the file inputs (docs/GUEST-GALLERIES.md §6). `name: null` takes
 * "Pokračovat bez jména".
 */
async function uploadAsNewGuest(page: Page, fileName: string, name: string | null) {
  await page.getByRole("button", { name: "Přidat fotky" }).click();
  const sheet = page.getByRole("dialog", { name: "Jak se jmenuješ?" });
  await expect(sheet).toBeVisible();
  if (name) {
    await sheet.getByRole("textbox").fill(name);
    await sheet.getByLabel("Vybrat fotky").setInputFiles(JPEG(fileName));
  } else {
    await sheet.getByLabel("Pokračovat bez jména").setInputFiles(JPEG(fileName));
  }
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Nahráno. Uvidí to všichni na svatbě.")).toBeVisible({
    timeout: 30_000,
  });
}

function tileCount(page: Page): Promise<number> {
  return page
    .getByRole("list", { name: "Fotky v galerii" })
    .locator('button[aria-label^="Otevřít"]')
    .count();
}

test.describe("guest uploads", () => {
  test("a link with allowUpload adds a photo the grid then shows", async ({ page }) => {
    await page.goto(`/g/${seed.uploadToken}/${seed.uploadSlug}`);

    // A first-time guest gets a button that opens the name sheet; the file
    // inputs live in the sheet — see the tappability test below for why.
    await expect(page.getByRole("button", { name: "Přidat fotky" })).toBeVisible();

    const before = await tileCount(page);

    await uploadAsNewGuest(page, "svatba.jpg", null);

    // Nothing is asked after the upload any more — the question came first.
    await expect(page.getByRole("dialog")).toHaveCount(0);

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

    await uploadAsNewGuest(page, "omylem.jpg", null);
    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBe(SEEDED + 1);

    // Capture order, oldest shot first (2026-08-25) — the photo just uploaded
    // has the newest `takenAt`, so it is the LAST tile, not the first.
    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await grid.locator('button[aria-label^="Otevřít"]').last().click();

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

  test("the file inputs are tappable, not display:none", async ({ page }) => {
    await page.goto(`/g/${seed.uploadToken}/${seed.uploadSlug}`);

    // Regression guard. The buttons used to call input.click() on a
    // display:none input, which iOS Safari refuses to honour — nothing at all
    // happened on an iPhone, the one device this bar exists for. Playwright
    // drives inputs directly via setInputFiles, so no other test can catch it.
    // Two places carry inputs now: the name sheet, and the bar once answered.
    async function expectTappable(inputs: ReturnType<Page["getByLabel"]>[]) {
      for (const input of inputs) {
        await expect(input).toBeVisible();
        const box = await input.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(0);
        expect(box?.height ?? 0).toBeGreaterThan(0);
        await expect(input).toHaveCSS("display", /^(?!none$)/);
      }
    }

    await page.getByRole("button", { name: "Vyfotit" }).click();
    const sheet = page.getByRole("dialog", { name: "Jak se jmenuješ?" });
    // The camera path keeps the camera: its primary input carries `capture`.
    await expect(sheet.getByLabel("Vyfotit")).toHaveAttribute("capture", "environment");
    await expectTappable([sheet.getByLabel("Vyfotit"), sheet.getByLabel("Pokračovat bez jména")]);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.evaluate(() => localStorage.setItem("gg.viewer.uploadNameAsked", "1"));
    await page.reload();
    await expectTappable([page.getByLabel("Přidat fotky"), page.getByLabel("Vyfotit")]);
  });

  test("asks for a name before the picker, and credits the photo with it everywhere", async ({
    page,
  }, testInfo) => {
    await page.goto(namingUrl(testInfo.project.name, "first"));
    await uploadAsNewGuest(page, "prvni.jpg", "Petra");
    await expect(page.getByText("Přidáváš jako Petra")).toBeVisible();

    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBe(1);
    await grid.locator('button[aria-label^="Otevřít"]').first().click();
    await expect(page.getByRole("dialog").getByText("Petra")).toBeVisible();

    // The next gallery this guest opens: no question — they already answered —
    // and the name still credits the photo. It used to land there anonymous,
    // because the name only ever reached the gallery it was typed in.
    await page.goto(namingUrl(testInfo.project.name, "second"));
    await expect(page.getByText("Přidáváš jako Petra")).toBeVisible();
    await page.getByLabel("Přidat fotky").setInputFiles(JPEG("druha.jpg"));
    await expect(page.getByText("Nahráno. Uvidí to všichni na svatbě.")).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBe(1);
    await grid.locator('button[aria-label^="Otevřít"]').first().click();
    await expect(page.getByRole("dialog").getByText("Petra")).toBeVisible();
  });

  test("skipping the name still goes straight to the picker, and it can be added later", async ({
    page,
  }, testInfo) => {
    await page.goto(namingUrl(testInfo.project.name, "skip"));
    await uploadAsNewGuest(page, "anonym.jpg", null);
    await expect(page.getByText("Přidáváš bez jména")).toBeVisible();

    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBe(1);
    await grid.locator('button[aria-label^="Otevřít"]').first().click();
    const lightbox = page.getByRole("dialog");
    await expect(lightbox.getByText("Autor fotky", { exact: false })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Asked once: a reload goes straight to the picker.
    await page.reload();
    await expect(page.getByLabel("Přidat fotky")).toBeVisible();

    // Adding the name afterwards re-credits the photo already there.
    await page.getByRole("button", { name: "Doplnit jméno" }).click();
    const sheet = page.getByRole("dialog", { name: "Jak se jmenuješ?" });
    await sheet.getByRole("textbox").fill("Honza");
    await sheet.getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByText("Přidáváš jako Honza")).toBeVisible();

    await expect.poll(() => tileCount(page), { timeout: 15_000 }).toBe(1);
    await grid.locator('button[aria-label^="Otevřít"]').first().click();
    await expect(page.getByRole("dialog").getByText("Honza")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");

    // And taken back: the credit is public, so clearing it has to work.
    await page.getByRole("button", { name: "Změnit" }).click();
    await sheet.getByRole("textbox").fill("");
    await sheet.getByRole("button", { name: "Odebrat jméno" }).click();
    await expect(page.getByText("Přidáváš bez jména")).toBeVisible();
    await grid.locator('button[aria-label^="Otevřít"]').first().click();
    await expect(page.getByRole("dialog").getByText("Honza")).toHaveCount(0, { timeout: 15_000 });
  });

  test("a stored name that breaks the rules never blocks the upload", async ({ request }) => {
    // An optional credit written by an older build (or edited by hand) must
    // be trimmed or dropped, not turned into a 400 for every photo.
    for (const displayName of ["x".repeat(200), "   "]) {
      const response = await request.post("/api/uploads/presign", {
        data: {
          shareToken: seed.uploadToken,
          anonKey: "00000000-0000-4000-8000-000000000002",
          displayName,
          files: [{ fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 1000 }],
        },
      });
      expect(response.status()).toBe(200);
    }
  });

  test("a read-only link to the same gallery offers no way to upload", async ({ page }) => {
    await page.goto(`/g/${seed.readOnlyToken}/${seed.uploadSlug}`);

    // Asserting on the title rather than the grid: this gallery may still be
    // empty depending on worker order, and an empty grid renders zero-height.
    await expect(page).toHaveTitle(/E2E Guest Gallery/);
    await expect(page.getByLabel("Přidat fotky")).toHaveCount(0);
    await expect(page.getByLabel("Vyfotit")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Přidat fotky" })).toHaveCount(0);
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
