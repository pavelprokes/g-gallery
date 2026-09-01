import { describe, expect, it } from "vitest";
import {
  isCardVisible,
  splitEventCards,
  visibleEventCards,
  type EventGalleryRow,
} from "./event-cards";

const NOW = new Date("2026-08-23T12:00:00Z");

function row(overrides: Partial<EventGalleryRow> = {}): EventGalleryRow {
  return {
    id: "g1",
    title: "Od hostů",
    eventKey: "od-hostu",
    position: 0,
    listedOnEvent: true,
    status: "PUBLISHED",
    trashedAt: null,
    eventLink: { revokedAt: null, expiresAt: null },
    ...overrides,
  };
}

describe("isCardVisible", () => {
  it("shows a listed, published gallery with a live link", () => {
    expect(isCardVisible(row(), NOW)).toBe(true);
  });

  it("hides an un-listed gallery — its own link is unaffected", () => {
    expect(isCardVisible(row({ listedOnEvent: false }), NOW)).toBe(false);
  });

  it("hides a gallery with no designated card link", () => {
    expect(isCardVisible(row({ eventLink: null }), NOW)).toBe(false);
  });

  it("hides a gallery whose card link was revoked", () => {
    expect(isCardVisible(row({ eventLink: { revokedAt: NOW, expiresAt: null } }), NOW)).toBe(false);
  });

  it("hides a gallery whose card link has expired, and keeps one expiring later", () => {
    const expired = row({
      eventLink: { revokedAt: null, expiresAt: new Date("2026-08-23T11:59:59Z") },
    });
    const live = row({
      eventLink: { revokedAt: null, expiresAt: new Date("2026-08-23T12:00:01Z") },
    });
    expect(isCardVisible(expired, NOW)).toBe(false);
    expect(isCardVisible(live, NOW)).toBe(true);
  });

  it("treats an expiry exactly at now as expired", () => {
    expect(isCardVisible(row({ eventLink: { revokedAt: null, expiresAt: NOW } }), NOW)).toBe(false);
  });

  it("hides an unpublished or trashed gallery", () => {
    expect(isCardVisible(row({ status: "DRAFT" }), NOW)).toBe(false);
    expect(isCardVisible(row({ status: "ARCHIVED" }), NOW)).toBe(false);
    expect(isCardVisible(row({ trashedAt: NOW }), NOW)).toBe(false);
  });

  it("hides a gallery with no key — it cannot be addressed at all", () => {
    expect(isCardVisible(row({ eventKey: null }), NOW)).toBe(false);
  });
});

describe("visibleEventCards", () => {
  it("orders by position and falls back to the Czech-collated title on ties", () => {
    const cards = visibleEventCards(
      [
        row({ id: "c", title: "Žofie", position: 0 }),
        row({ id: "a", title: "Kompletní set", position: 2 }),
        row({ id: "b", title: "Čeněk", position: 0 }),
      ],
      NOW,
    );
    // Č sorts before Ž in Czech, and both come before position 2.
    expect(cards.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("drops invisible rows before sorting", () => {
    const cards = visibleEventCards(
      [row({ id: "a" }), row({ id: "b", listedOnEvent: false }), row({ id: "c", eventLink: null })],
      NOW,
    );
    expect(cards.map((c) => c.id)).toEqual(["a"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [row({ id: "a", position: 5 }), row({ id: "b", position: 1 })];
    visibleEventCards(input, NOW);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("splitEventCards", () => {
  const card = (id: string, acceptsUploads: boolean) => ({ id, acceptsUploads });

  it("keeps the photographer's galleries apart from the guests', in order", () => {
    const { main, guest } = splitEventCards([
      card("preview", false),
      card("guests", true),
      card("full", false),
    ]);
    expect(main.map((c) => c.id)).toEqual(["preview", "full"]);
    expect(guest.map((c) => c.id)).toEqual(["guests"]);
  });

  it("copes with either group being empty", () => {
    expect(splitEventCards([card("guests", true)])).toEqual({
      main: [],
      guest: [card("guests", true)],
    });
    expect(splitEventCards([])).toEqual({ main: [], guest: [] });
  });
});
