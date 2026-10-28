"use client";

// A reel's music in the admin's browser (docs/REELS.md §2, §5): the track
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
