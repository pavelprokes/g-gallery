import { beforeEach, describe, expect, it, vi } from "vitest";

// next/headers is only available inside a request scope, so the cookie store
// is faked here — the logic under test is the HMAC binding, not Next's plumbing.
const store = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      store.set(name, value);
    },
  }),
}));

const { isUnlocked, setUnlockCookie } = await import("./share-unlock");

const SHARE_LINK_ID = "clx0000000000000000000000";
const PASSWORD_HASH = "aabbccdd:11223344";

describe("share-unlock", () => {
  beforeEach(() => {
    store.clear();
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-value-at-least-32-chars!!");
  });

  it("denies access when no cookie is present", async () => {
    await expect(isUnlocked(SHARE_LINK_ID, PASSWORD_HASH)).resolves.toBe(false);
  });

  it("grants access after the cookie is set", async () => {
    await setUnlockCookie(SHARE_LINK_ID, PASSWORD_HASH);
    await expect(isUnlocked(SHARE_LINK_ID, PASSWORD_HASH)).resolves.toBe(true);
  });

  it("invalidates the cookie when the password changes", async () => {
    await setUnlockCookie(SHARE_LINK_ID, PASSWORD_HASH);
    await expect(isUnlocked(SHARE_LINK_ID, "eeff0011:55667788")).resolves.toBe(false);
  });

  it("does not let one link's cookie unlock another link", async () => {
    await setUnlockCookie(SHARE_LINK_ID, PASSWORD_HASH);
    await expect(isUnlocked("clx1111111111111111111111", PASSWORD_HASH)).resolves.toBe(false);
  });

  it("rejects a forged cookie value", async () => {
    store.set(`gg_unlock_${SHARE_LINK_ID}`, "0".repeat(64));
    await expect(isUnlocked(SHARE_LINK_ID, PASSWORD_HASH)).resolves.toBe(false);
  });

  it("rejects a truncated cookie value without throwing", async () => {
    await setUnlockCookie(SHARE_LINK_ID, PASSWORD_HASH);
    const name = `gg_unlock_${SHARE_LINK_ID}`;
    store.set(name, store.get(name)!.slice(0, 10));
    await expect(isUnlocked(SHARE_LINK_ID, PASSWORD_HASH)).resolves.toBe(false);
  });

  it("is bound to the signing secret", async () => {
    await setUnlockCookie(SHARE_LINK_ID, PASSWORD_HASH);
    vi.stubEnv("BETTER_AUTH_SECRET", "a-completely-different-secret-value!!");
    await expect(isUnlocked(SHARE_LINK_ID, PASSWORD_HASH)).resolves.toBe(false);
  });
});
