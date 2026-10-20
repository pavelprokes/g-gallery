import { describe, expect, it } from "vitest";
import {
  adminViewQuery,
  DEFAULT_VIEW,
  filterCounts,
  matchesAdminView,
  parseAdminView,
  sortAdminPhotos,
  toggleAdminFilter,
  type PhotoFacts,
} from "./admin-photo-filters";

const photo = (over: Partial<PhotoFacts>): PhotoFacts => ({
  id: "p",
  fileName: "svatba_0001_PPR1.jpg",
  fileOrderKey: "svatba0041ppr0011jpg",
  favorites: 0,
  reactions: 0,
  print: 0,
  comments: 0,
  views: 0,
  viewers: 0,
  highlight: false,
  inVideoDraft: false,
  people: [],
  guest: false,
  video: false,
  chapter: null,
  ...over,
});

describe("parseAdminView / adminViewQuery", () => {
  it("round-trips a view through the URL", () => {
    const view = parseAdminView({
      f: "favorites,print",
      person: "abc",
      q: " PPR55 ",
      sort: "views",
    });
    expect(view).toEqual({
      filters: ["print", "favorites"],
      person: "abc",
      chapter: null,
      q: "PPR55",
      sort: "views",
    });
    expect(adminViewQuery(view)).toBe("?f=print%2Cfavorites&person=abc&q=PPR55&sort=views");
    expect(parseAdminView(Object.fromEntries(new URLSearchParams(adminViewQuery(view))))).toEqual(
      view,
    );
  });

  it("keeps the old links and drops what it does not know", () => {
    expect(parseAdminView({ print: "1" }).filters).toEqual(["print"]);
    expect(parseAdminView({ timeline: "1" }).sort).toBe("order");
    expect(parseAdminView({ f: "nope", sort: "bogus", person: "<script>" })).toEqual(DEFAULT_VIEW);
    expect(adminViewQuery(DEFAULT_VIEW)).toBe("");
  });
});

describe("toggleAdminFilter", () => {
  it("switches one filter and drops its opposite", () => {
    const tagged = toggleAdminFilter(DEFAULT_VIEW, "tagged");
    expect(tagged.filters).toEqual(["tagged"]);
    expect(toggleAdminFilter(tagged, "untagged").filters).toEqual(["untagged"]);
    expect(toggleAdminFilter(tagged, "tagged").filters).toEqual([]);
  });
});

describe("matchesAdminView", () => {
  it("needs every filter, the person, the chapter and the name", () => {
    const view = { ...DEFAULT_VIEW, filters: ["print", "favorites"] as const, person: "s" };
    const both = photo({ print: 2, favorites: 1, people: ["s"] });
    expect(matchesAdminView({ ...view, filters: [...view.filters] }, both)).toBe(true);
    expect(
      matchesAdminView({ ...view, filters: [...view.filters] }, { ...both, favorites: 0 }),
    ).toBe(false);
    expect(matchesAdminView({ ...DEFAULT_VIEW, q: "ppr1" }, both)).toBe(true);
    expect(matchesAdminView({ ...DEFAULT_VIEW, chapter: "c" }, both)).toBe(false);
  });
});

describe("filterCounts", () => {
  it("counts each filter on top of the active ones", () => {
    const photos = [
      photo({ id: "a", print: 1, favorites: 1 }),
      photo({ id: "b", print: 1 }),
      photo({ id: "c", favorites: 2 }),
    ];
    const counts = filterCounts({ ...DEFAULT_VIEW, filters: ["print"] }, photos);
    expect(counts.print).toBe(2);
    expect(counts.favorites).toBe(1);
  });

  it("counts an opposite as the switch would leave it", () => {
    const photos = [photo({ id: "a", people: ["s"] }), photo({ id: "b" }), photo({ id: "c" })];
    expect(filterCounts({ ...DEFAULT_VIEW, filters: ["tagged"] }, photos).untagged).toBe(2);
  });
});

describe("sortAdminPhotos", () => {
  it("orders by views, keeping the gallery's order on ties", () => {
    const photos = [
      photo({ id: "a", views: 1 }),
      photo({ id: "b", views: 5 }),
      photo({ id: "c", views: 1 }),
    ];
    expect(sortAdminPhotos("views", photos).map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(
      sortAdminPhotos("name", [
        photo({ id: "x", fileOrderKey: "s00210jpg" }),
        photo({ id: "y", fileOrderKey: "s0019jpg" }),
      ]).map((p) => p.id),
    ).toEqual(["y", "x"]);
  });
});
