// Where a photo is sharp (docs/SOCIAL-VIDEO.md §5, "Without a face"): the
// camera's aim when there is no face to frame. A detail at a wedding — shoes,
// rings, a cake — is shot wide open, so its subject is the sharp part and the
// rest is blur. Pure; the face worker hands it two small copies of the photo.

/** The longer side of the copy that decides whether anything stands out. */
export const FOCUS_EDGE = 256;
/** The longer side of the copy the aim is measured on: at 256 px a ring and
 * the baby's breath in front of it are both "sharp"; at 512 the ring wins. */
export const AIM_EDGE = 512;
/** Bumped when the aim changes, so `needsFocus` (aim.ts) sends the photos aimed
 * by an older one back to the scan. 2: the aim of 2026-10-26 below. */
export const FOCUS_VERSION = 2;
/** Tiles along the longer side. */
const GRID = 12;
/** The sharpest tile against the median one: below it nothing stands out
 * enough to aim at. On a real wedding the detail shots scored 29–61, while a
 * bride from behind against a sharp window scored 5.6 — and aiming her by the
 * sharpest tile landed between her and the dress beside her; the upper third
 * frames her better. */
export const FOCUS_FROM = 8;
/** The sharpest tile's energy must reach this: below, nothing in the photo is
 * crisp (on real detail shots at 256 px the sharp tiles score 3 600–7 100). */
const MIN_TOP_ENERGY = 500;
/** The median is read as at least this, so a photo that is mostly black or
 * blown-out sky does not score an endless strength from a single textured tile. */
const MEDIAN_FLOOR = 50;

/** The box filter the aim blurs with: what a 9 px blur takes away is detail
 * that was in focus (Crété-Roffet's no-reference blur metric, the one
 * scikit-image ships as `blur_effect`). */
const BLUR = 9;
/** A tile with less mean gradient than this is flat (sky, a white tablecloth)
 * and is never aimed at, however its few edges compare. */
const FLAT_BELOW = 2;
/** A tile's sharpness counts in full from this share of the busiest tile's
 * gradient, less below it: the blur metric alone ignores contrast, and a
 * smooth cake or a bare wall would win with one fine edge. */
const BUSY_FROM = 0.3;
/** How much the edges count against the middle: ×(1 − CENTRE) in a corner,
 * ×(1 − CENTRE / 2) at the middle of a side. Baby's breath along the bottom,
 * rocks in a corner, the grain of a table at the edge are as sharp as the rings
 * in the middle — the photographer put the subject in, not out. */
const CENTRE = 0.8;
/** Tiles at least this share of the aimed tile's sharpness, touching it, are
 * the subject… */
const SUBJECT_SHARE = 0.9;
/** …up to this many tiles from it, so a photo sharp all along one plane does
 * not hand the camera a box too wide to push into. */
const REACH = 2;

/** The sharp part of a photo, 0–1 of it, origin top left. */
export interface Focus {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The sharpest tile over the median one (≥ FOCUS_FROM). */
  strength: number;
}

/** RGBA pixels, as `ImageData` holds them. */
export interface Pixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/**
 * The sharp part of a photo, or null when nothing stands out. `small` (longer
 * side FOCUS_EDGE) decides whether anything does; `large`, the same photo at
 * AIM_EDGE, says where.
 */
export function focusOf(small: Pixels, large: Pixels): Focus | null {
  const tile = Math.max(2, Math.floor(Math.max(small.width, small.height) / GRID));
  const cols = Math.floor(small.width / tile);
  const rows = Math.floor(small.height / tile);
  if (cols < 2 || rows < 2) return null;

  // The Laplacian's energy per tile: high where edges are crisp, near zero in blur.
  const grey = greyOf(small);
  const { width } = small;
  const energy = new Float64Array(cols * rows);
  const count = new Uint32Array(cols * rows);
  for (let y = 1; y < rows * tile - 1 && y < small.height - 1; y++) {
    for (let x = 1; x < cols * tile - 1 && x < width - 1; x++) {
      const i = y * width + x;
      const lap = 4 * grey[i]! - grey[i - 1]! - grey[i + 1]! - grey[i - width]! - grey[i + width]!;
      const t = Math.floor(y / tile) * cols + Math.floor(x / tile);
      energy[t]! += lap * lap;
      count[t]! += 1;
    }
  }
  const scores = Array.from(energy, (e, t) => (count[t] ? e / count[t]! : 0));
  const top = Math.max(...scores);
  if (top < MIN_TOP_ENERGY) return null;
  const median = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)]!;
  const strength = top / Math.max(median, MEDIAN_FLOOR);
  if (strength < FOCUS_FROM) return null;

  // The same grid on the large copy: its tiles span the same part of the photo.
  const k = large.width / small.width;
  const big = Math.max(2, Math.round(tile * k));
  const sharp = sharpness(large, big, cols, rows);
  const aimed = sharp.map((s, t) => {
    const dx = ((t % cols) + 0.5) / cols - 0.5;
    const dy = (Math.floor(t / cols) + 0.5) / rows - 0.5;
    return s * (1 - CENTRE * 2 * (dx * dx + dy * dy));
  });
  const start = aimed.indexOf(Math.max(...aimed));
  const sx = start % cols;
  const sy = Math.floor(start / cols);
  const floor = SUBJECT_SHARE * sharp[start]!;

  // The sharp tiles connected to the aimed one: two sharp spots apart are
  // not one subject spanning the blur between them.
  const seen = new Set([start]);
  const queue = [start];
  let x0 = cols;
  let y0 = rows;
  let x1 = 0;
  let y1 = 0;
  for (let t = queue.pop(); t !== undefined; t = queue.pop()) {
    const cx = t % cols;
    const cy = Math.floor(t / cols);
    x0 = Math.min(x0, cx);
    y0 = Math.min(y0, cy);
    x1 = Math.max(x1, cx + 1);
    y1 = Math.max(y1, cy + 1);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (Math.abs(nx - sx) > REACH || Math.abs(ny - sy) > REACH) continue;
        const n = ny * cols + nx;
        if (seen.has(n) || sharp[n]! < floor) continue;
        seen.add(n);
        queue.push(n);
      }
    }
  }
  const r = (n: number) => Math.round(Math.min(1, n) * 1000) / 1000;
  return {
    x: r((x0 * tile) / small.width),
    y: r((y0 * tile) / small.height),
    w: r(((x1 - x0) * tile) / small.width),
    h: r(((y1 - y0) * tile) / small.height),
    strength: Math.round(Math.min(strength, 9999) * 10) / 10,
  };
}

function greyOf({ data, width, height }: Pixels): Float32Array {
  const grey = new Float32Array(width * height);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  }
  return grey;
}

/**
 * Per tile, how much of its edges a BLUR px blur takes away (1: all of them,
 * crisp; near 0: they were blurred already), the lesser of the two directions,
 * damped where the tile is plainer than BUSY_FROM of the busiest one.
 */
function sharpness(pixels: Pixels, tile: number, cols: number, rows: number): number[] {
  const { width, height } = pixels;
  const grey = greyOf(pixels);
  const ratio = new Array<number>(cols * rows).fill(Infinity);
  const gradient = new Float64Array(cols * rows);
  for (const horizontal of [true, false]) {
    const blurred = boxBlur(grey, width, height, horizontal);
    const edges = new Float64Array(cols * rows);
    const lost = new Float64Array(cols * rows);
    // Across (dx, dy), smoothed along the other direction; the outer pixel
    // ring has no neighbours and is left out.
    const [dx, dy] = horizontal ? [1, width] : [width, 1];
    for (let y = 1; y < Math.min(rows * tile, height - 1); y++) {
      const row = Math.floor(y / tile) * cols;
      for (let x = 1; x < Math.min(cols * tile, width - 1); x++) {
        const i = y * width + x;
        const e = Math.abs(
          grey[i + dx - dy]! +
            2 * grey[i + dx]! +
            grey[i + dx + dy]! -
            grey[i - dx - dy]! -
            2 * grey[i - dx]! -
            grey[i - dx + dy]!,
        );
        const b = Math.abs(
          blurred[i + dx - dy]! +
            2 * blurred[i + dx]! +
            blurred[i + dx + dy]! -
            blurred[i - dx - dy]! -
            2 * blurred[i - dx]! -
            blurred[i - dx + dy]!,
        );
        const t = row + Math.floor(x / tile);
        edges[t]! += e;
        lost[t]! += e > b ? e - b : 0;
      }
    }
    for (let t = 0; t < ratio.length; t++) {
      ratio[t] = Math.min(ratio[t]!, edges[t]! > 0 ? lost[t]! / edges[t]! : 0);
      gradient[t]! += edges[t]! / (tile * tile) / 2;
    }
  }
  const busiest = Math.max(...gradient);
  return ratio.map((s, t) => {
    const g = gradient[t]!;
    if (g < FLAT_BELOW) return 0;
    return s * Math.min(1, g / (BUSY_FROM * busiest));
  });
}

/** A BLUR-wide box filter along one direction, edges clamped. */
function boxBlur(grey: Float32Array, width: number, height: number, horizontal: boolean) {
  const out = new Float32Array(grey.length);
  const half = Math.floor(BLUR / 2);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width : line;
    const at = (i: number) => base + Math.min(length - 1, Math.max(0, i)) * step;
    let sum = 0;
    for (let i = -half; i <= half; i++) sum += grey[at(i)]!;
    for (let i = 0; i < length; i++) {
      out[base + i * step] = sum / BLUR;
      sum += grey[at(i + half + 1)]! - grey[at(i - half)]!;
    }
  }
  return out;
}
