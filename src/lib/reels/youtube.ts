// A YouTube address the photographer pastes, for the player the reels page
// shows so a song can be listened to there (docs/REELS.md §2). Only the
// video's id is taken; the player is YouTube's own privacy-enhanced embed —
// nothing is downloaded from YouTube.

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

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
}
