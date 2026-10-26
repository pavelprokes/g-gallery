// Where a photo is sharp (docs/SOCIAL-VIDEO.md §5, "Without a face"): the
// camera's aim when there is no face to frame. A detail at a wedding — shoes,
// rings, a cake — is shot wide open, so its subject is the sharp part and the
// rest is blur. Pure; the face worker hands it a small copy of the photo.

/** The longer side the photo is analysed at. */
export const FOCUS_EDGE = 256;
/** Tiles along the longer side. */
const GRID = 12;
/** The sharpest tile against the median one: below it nothing stands out
 * enough to aim at. On a real wedding the detail shots scored 29–61, while a
 * bride from behind against a sharp window scored 5.6 — and aiming her by the
 * sharpest tile landed between her and the dress beside her; the upper third
 * frames her better. */
export const FOCUS_FROM = 8;
/** Tiles at least this share of the sharpest one, touching it, are the subject. */
const SUBJECT_SHARE = 0.45;
/** The sharpest tile's energy must reach this: below, nothing in the photo is
 * crisp (on real detail shots at 256 px the sharp tiles score 3 600–7 100). */
const MIN_TOP_ENERGY = 500;
/** The median is read as at least this, so a photo that is mostly black or
 * blown-out sky does not score an endless strength from a single textured tile. */
const MEDIAN_FLOOR = 50;

/** The sharp part of a photo, 0–1 of it, origin top left. */
export interface Focus {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The sharpest tile over the median one (≥ FOCUS_FROM). */
  strength: number;
}

/** The sharp part of RGBA pixels `width` × `height`, or null when nothing stands out. */
export function focusOf(rgba: ArrayLike<number>, width: number, height: number): Focus | null {
  const tile = Math.max(2, Math.floor(Math.max(width, height) / GRID));
  const cols = Math.floor(width / tile);
  const rows = Math.floor(height / tile);
  if (cols < 2 || rows < 2) return null;

  const grey = new Float32Array(width * height);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
  }
  // The Laplacian's energy per tile: high where edges are crisp, near zero in blur.
  const energy = new Float64Array(cols * rows);
  const count = new Uint32Array(cols * rows);
  for (let y = 1; y < rows * tile - 1 && y < height - 1; y++) {
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

  // The sharp tiles connected to the sharpest one: two sharp spots apart are
  // not one subject spanning the blur between them.
  const start = scores.indexOf(top);
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
        const n = ny * cols + nx;
        if (seen.has(n) || scores[n]! < SUBJECT_SHARE * top) continue;
        seen.add(n);
        queue.push(n);
      }
    }
  }
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    x: r((x0 * tile) / width),
    y: r((y0 * tile) / height),
    w: r(((x1 - x0) * tile) / width),
    h: r(((y1 - y0) * tile) / height),
    strength: Math.round(Math.min(strength, 9999) * 10) / 10,
  };
}
