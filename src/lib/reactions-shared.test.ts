import { describe, expect, it } from "vitest";
import cs from "../../messages/cs.json";
import en from "../../messages/en.json";
import {
  isReactionKind,
  REACTION_EMOJI,
  REACTION_KINDS,
  totalReactions,
  type PhotoReactionState,
} from "./reactions-shared";

describe("reaction vocabulary", () => {
  it("has an emoji for every kind", () => {
    // A missing entry would render `undefined` into the picker rather than fail.
    for (const kind of REACTION_KINDS) {
      expect(REACTION_EMOJI[kind]).toBeTruthy();
    }
  });

  it("has a translated label for every kind, in every locale", () => {
    for (const messages of [cs, en]) {
      for (const kind of REACTION_KINDS) {
        expect(messages.gallery.reactions[kind]).toBeTruthy();
      }
    }
  });

  it("accepts only the known kinds", () => {
    expect(isReactionKind("LOVE")).toBe(true);
    expect(isReactionKind("ROCKET")).toBe(false);
    expect(isReactionKind("love")).toBe(false);
    expect(isReactionKind("")).toBe(false);
  });

  it("lists no duplicates", () => {
    expect(new Set(REACTION_KINDS).size).toBe(REACTION_KINDS.length);
  });
});

describe("totalReactions", () => {
  it("sums across kinds", () => {
    const state: PhotoReactionState = { counts: { LOVE: 3, WOW: 2 }, mine: "LOVE" };
    expect(totalReactions(state)).toBe(5);
  });

  it("is zero for a photo nobody reacted to", () => {
    expect(totalReactions({ counts: {}, mine: null })).toBe(0);
    expect(totalReactions(undefined)).toBe(0);
  });

  it("ignores a viewer's own pick — the total counts people, not selections", () => {
    expect(totalReactions({ counts: { CLAP: 1 }, mine: "CLAP" })).toBe(1);
  });
});
