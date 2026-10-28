// Where to slide a song in Instagram's music picker so its beats meet a
// silent reel's cuts (docs/REELS.md §2, "With sound or without").

import type { TrackKind } from "@/lib/reels/music-library";
import { formatDuration } from "@/lib/video";

/** What is known about where a track sits in its song. */
export interface HintSource {
  kind: TrackKind;
  startAt?: number;
  durationMs?: number;
  /** How long the decoded sound is. */
  decodedMs: number;
}

/**
 * Where the reel's music starts in the song itself, said the way Instagram's
 * music picker can be set: a file and a full Instagram track know it; a
 * YouTube listening knows where it began; a microphone or another tab only
 * relative to what was played; an Instagram excerpt only within the excerpt.
 */
export function startHint(source: HintSource, offset: number): string {
  const at = (seconds: number) => formatDuration(seconds * 1000);
  switch (source.kind) {
    case "listened":
      return source.startAt !== undefined
        ? `zhruba na ${at(source.startAt + offset)}`
        : `o ${Math.round(offset)} s za místo, odkud jsi ji pouštěl`;
    case "instagram": {
      const excerpt =
        source.durationMs !== undefined && source.decodedMs < source.durationMs - 2000;
      return excerpt ? `na ${at(offset)} ukázky (ukázka není celá písnička)` : `na ${at(offset)}`;
    }
    default:
      return `na ${at(offset)}`;
  }
}
