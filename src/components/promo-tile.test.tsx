import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getViewerId = vi.hoisted(() => vi.fn<() => string | null>());

vi.mock("@/lib/viewer-id", () => ({ getViewerId }));
// The tile's only message is its aria-label; echoing the key keeps the test
// about behaviour rather than about copy.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { PromoTile } from "@/components/promo-tile";
import type { GalleryPromo } from "@/lib/promo-card";

const ANON_KEY = "2b6f0cc9-04d6-4b8f-9a0f-3f9b6b2f2f11";

const promo: GalleryPromo = {
  id: "placement_1",
  slot: 5,
  eyebrow: "Fotografie",
  headline: "Fotil Pavel Prokeš",
  body: null,
  ctaLabel: null,
  ctaUrl: "https://example.test/portfolio",
  theme: "LIGHT",
};

let sendBeacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getViewerId.mockReturnValue(ANON_KEY);
  sendBeacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", {
    value: sendBeacon,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderTile(token?: string) {
  render(<PromoTile promo={promo} width={300} height={200} token={token} />);
  return screen.getByRole("link");
}

/** `fireEvent` has no `auxClick` helper, so the event is built by hand. */
function auxClick(button: number): MouseEvent {
  return new MouseEvent("auxclick", { bubbles: true, cancelable: true, button });
}

function beaconedCall(): [string, Blob] {
  const call = sendBeacon.mock.calls[0];
  if (!call) throw new Error("no beacon was sent");
  return call as [string, Blob];
}

async function beaconedPayload(): Promise<unknown> {
  const [, blob] = beaconedCall();
  return JSON.parse(await blob.text());
}

describe("PromoTile click tracking", () => {
  it("beacons a PROMO_CLICK to the gallery's activity route", async () => {
    fireEvent.click(renderTile("share-token"));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]?.[0]).toBe("/api/g/share-token/activity");
    expect(await beaconedPayload()).toEqual({ anonKey: ANON_KEY, type: "PROMO_CLICK" });
  });

  it("percent-encodes the token it puts in the URL", () => {
    fireEvent.click(renderTile("a/b?c"));

    expect(sendBeacon.mock.calls[0]?.[0]).toBe("/api/g/a%2Fb%3Fc/activity");
  });

  it("lets the navigation happen whatever the beacon does", () => {
    // The click must never be delayed or swallowed: no preventDefault, and a
    // refusing sendBeacon (queue full, offline) changes nothing.
    sendBeacon.mockReturnValue(false);

    expect(fireEvent.click(renderTile("share-token"))).toBe(true);
  });

  it("is inert without a token", () => {
    // The prop is optional so the tile renders anywhere; with no share link
    // there is nothing to report to, and the link still works.
    const link = renderTile();

    expect(fireEvent.click(link)).toBe(true);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("stays silent for a viewer who opted out", () => {
    getViewerId.mockReturnValue(null);

    fireEvent.click(renderTile("share-token"));

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("reports a middle-click but not a right-click", () => {
    const link = renderTile("share-token");

    fireEvent(link, auxClick(2)); // context menu, not a navigation
    expect(sendBeacon).not.toHaveBeenCalled();

    fireEvent(link, auxClick(1)); // opens a background tab
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("keeps noreferrer, so the share token never reaches the target site", () => {
    // CLAUDE.md invariant #7 — the whole reason clicks are counted first-party.
    expect(renderTile("share-token")).toHaveAttribute("rel", "noopener noreferrer");
  });
});
