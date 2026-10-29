"use client";

// A reel's music in the admin's browser (docs/REELS.md §2, §6): the track
// decoded once, its beat found, and the stretch the reel plays cut out with
// a short fade in and the last photo's fade out — by the Web Audio API, so
// the preview and the file hear the same thing.

import { analyzeBeats, type BeatAnalysis } from "@/lib/reels/beats";

/** What the file is encoded at: AAC's usual rate, and every browser resamples to it. */
export const REEL_SAMPLE_RATE = 48_000;
/** A cut into the music mid-note clicks without a few milliseconds of fade. */
const FADE_IN = 0.02;

export async function decodeTrack(blob: Blob): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, 1, REEL_SAMPLE_RATE);
  return context.decodeAudioData(await blob.arrayBuffer());
}

/** One channel, the average of all — what the beat is found in. */
export function monoOf(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += channel[i]! / buffer.numberOfChannels;
  }
  return out;
}

export function analyzeTrack(buffer: AudioBuffer): BeatAnalysis {
  return analyzeBeats(monoOf(buffer), buffer.sampleRate);
}

/** The gain over a reel: up in a moment, down over the last `fadeOut` seconds. */
export function applyEnvelope(gain: AudioParam, at: number, duration: number, fadeOut: number) {
  gain.setValueAtTime(0, at);
  gain.linearRampToValueAtTime(1, at + FADE_IN);
  gain.setValueAtTime(1, at + Math.max(FADE_IN, duration - fadeOut));
  gain.linearRampToValueAtTime(0, at + duration);
}

/** The reel's sound: `duration` seconds of the track from `offset`, enveloped. */
export async function reelAudio(
  track: AudioBuffer,
  offset: number,
  duration: number,
  fadeOut: number,
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(
    Math.min(2, track.numberOfChannels),
    Math.ceil(duration * REEL_SAMPLE_RATE),
    REEL_SAMPLE_RATE,
  );
  const source = context.createBufferSource();
  source.buffer = track;
  const gain = context.createGain();
  applyEnvelope(gain.gain, 0, duration, fadeOut);
  source.connect(gain).connect(context.destination);
  source.start(0, offset, duration);
  return context.startRendering();
}

/**
 * Called inside the tap that starts playback. iOS (every browser there is
 * WebKit) lets a page's Web Audio sound only once it was started from a tap,
 * and mutes it with the ring/silent switch unless the page's audio session
 * says it is playing media — as a video player's sound does.
 */
export function unlockAudio(context: AudioContext): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  try {
    if (session) session.type = "playback";
  } catch {
    // An older WebKit without the setter: the switch then decides.
  }
  void context.resume().catch(() => {});
  // A sample of silence, started within the tap, is what wakes iOS's output.
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, context.sampleRate);
  source.connect(context.destination);
  source.start(0);
}

/** How long to wait for a context to start before playing without it. */
const RESUME_WAIT_MS = 400;

/**
 * The clock a preview runs on: the sound's own, when the context plays —
 * the picture then follows the music — or the page's, silently, when the
 * browser kept the context asleep, so the photos still move.
 */
export async function clockFor(
  context: AudioContext,
): Promise<{ now(): number; audible: boolean }> {
  if (context.state !== "running") {
    await Promise.race([
      context.resume().catch(() => {}),
      new Promise((done) => setTimeout(done, RESUME_WAIT_MS)),
    ]);
  }
  return context.state === "running"
    ? { now: () => context.currentTime, audible: true }
    : { now: () => performance.now() / 1000, audible: false };
}
