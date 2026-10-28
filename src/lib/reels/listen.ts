"use client";

// Listening to a song instead of adding its file (docs/REELS.md §2): through
// the microphone — a phone held to a speaker — or by sharing a browser tab
// with its sound, where the song plays in a YouTube player or anywhere else.
// What is heard is recorded by MediaRecorder for its beat only: the reel made
// from it has no sound, and the song itself is added in Instagram.

export type ListenSource = "mic" | "tab";

/** Long enough for the tempo and a bar to start on; longer only costs memory. */
export const MAX_LISTEN_SECONDS = 180;

export class NoTabAudioError extends Error {}

export interface Listening {
  /** Stops and returns what was heard. */
  stop(): Promise<Blob>;
  /** Stops and throws the recording away. */
  cancel(): void;
}

/** What this browser can listen through. Sharing a tab's sound is a desktop
 * Chrome/Edge thing; phones have no `getDisplayMedia` at all. */
export function listenSources(): { mic: boolean; tab: boolean } {
  if (typeof navigator === "undefined" || !navigator.mediaDevices)
    return { mic: false, tab: false };
  const recorder = typeof MediaRecorder !== "undefined";
  return {
    mic: recorder && typeof navigator.mediaDevices.getUserMedia === "function",
    tab: recorder && typeof navigator.mediaDevices.getDisplayMedia === "function",
  };
}

/** The raw sound: no echo cancelling, noise suppression or gain riding, which
 * flatten exactly the drum hits the beat is found from. */
const RAW_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

async function streamOf(source: ListenSource): Promise<MediaStream> {
  if (source === "mic") return navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
  const shared = await navigator.mediaDevices.getDisplayMedia({
    // Chrome shares no sound without a picture; the picture is dropped at once.
    video: true,
    audio: RAW_AUDIO,
    // Chrome's hints: offer this tab first, where the YouTube player is.
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    systemAudio: "include",
  } as DisplayMediaStreamOptions);
  for (const track of shared.getVideoTracks()) track.stop();
  if (shared.getAudioTracks().length === 0) throw new NoTabAudioError();
  return new MediaStream(shared.getAudioTracks());
}

export async function listen(source: ListenSource, onEnded: () => void): Promise<Listening> {
  const stream = await streamOf(source);
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
  });
  // Sharing stopped from the browser's own bar ends the listening too.
  for (const track of stream.getAudioTracks()) track.addEventListener("ended", onEnded);
  const limit = setTimeout(onEnded, MAX_LISTEN_SECONDS * 1000);
  recorder.start(1000);
  const halt = () => {
    clearTimeout(limit);
    if (recorder.state !== "inactive") recorder.stop();
  };
  return {
    stop() {
      halt();
      return finished;
    },
    cancel() {
      halt();
      chunks.length = 0;
    },
  };
}
