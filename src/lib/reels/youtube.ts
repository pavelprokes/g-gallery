// A YouTube address the photographer pastes, for the player the reels page
// shows so a song can be listened to there (docs/REELS.md §2). Only the
// video's id is taken; the player is YouTube's own privacy-enhanced embed,
// started through its IFrame API — nothing is downloaded from YouTube: the
// page hears the tab while the player plays.

const ID = /^[A-Za-z0-9_-]{11}$/;

/** The video id of a youtube.com or youtu.be address, or null. */
export function youtubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id =
      url.searchParams.get("v") ??
      url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ??
      null;
  }
  return id && ID.test(id) ? id : null;
}

export const YOUTUBE_PLAYER_ORIGIN = "https://www.youtube-nocookie.com";

/** The privacy-enhanced player, with its IFrame API on so the page can start
 * it at the moment the listening starts (`playerCommand`). */
export function youtubeEmbedUrl(id: string, pageOrigin?: string): string {
  const url = new URL(`${YOUTUBE_PLAYER_ORIGIN}/embed/${id}`);
  url.searchParams.set("rel", "0");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("enablejsapi", "1");
  if (pageOrigin) url.searchParams.set("origin", pageOrigin);
  return url.toString();
}

/** A message for the player's IFrame API — `seekTo`, `playVideo`, `pauseVideo`. */
export function playerCommand(func: "seekTo" | "playVideo" | "pauseVideo", args: unknown[] = []) {
  return JSON.stringify({ event: "command", func, args });
}

/** "1:23" or "83" → 83 seconds; null for anything else. */
export function parseClock(input: string): number | null {
  const match = input.trim().match(/^(?:(\d{1,3}):)?(\d{1,5})$/);
  if (!match) return null;
  const [, minutes, seconds] = match;
  if (minutes !== undefined && Number(seconds) >= 60) return null;
  return Number(minutes ?? 0) * 60 + Number(seconds);
}
