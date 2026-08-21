/**
 * Reaction vocabulary shared by the browser and the server.
 *
 * Deliberately free of `server-only` and of any Prisma import: the gallery is a
 * Client Component, and pulling the server module in would drag the database
 * client into the browser bundle.
 */

/** The order the picker renders in. Mirrors the ReactionKind enum in Prisma. */
export const REACTION_KINDS = ["LOVE", "WOW", "LAUGH", "SAD", "CLAP"] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

export const REACTION_EMOJI: Record<ReactionKind, string> = {
  LOVE: "❤️",
  WOW: "😮",
  LAUGH: "😂",
  SAD: "🥲",
  CLAP: "👏",
};

/** Czech labels for screen readers and tooltips. */
export const REACTION_LABEL: Record<ReactionKind, string> = {
  LOVE: "Srdce",
  WOW: "Úžas",
  LAUGH: "Smích",
  SAD: "Dojetí",
  CLAP: "Potlesk",
};

export interface PhotoReactionState {
  /** kind -> number of distinct viewers */
  counts: Partial<Record<ReactionKind, number>>;
  /** what the requesting viewer picked, if anything */
  mine: ReactionKind | null;
}

export function isReactionKind(value: string): value is ReactionKind {
  return (REACTION_KINDS as readonly string[]).includes(value);
}

/** Total across all kinds — what the admin grid and the grid badge show. */
export function totalReactions(state: PhotoReactionState | undefined): number {
  if (!state) return 0;
  return Object.values(state.counts).reduce((sum, n) => sum + (n ?? 0), 0);
}
