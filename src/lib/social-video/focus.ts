// Where a photo is sharp (docs/SOCIAL-VIDEO.md §5, "Without a face"): the
// camera's aim when there is no face to frame. A detail at a wedding — shoes,
// rings, a cake — is shot wide open, so its subject is the sharp part and the
// rest is blur. Pure; the face worker hands it a small copy of the photo.

/** The longer side the photo is analysed at. */
export const FOCUS_EDGE = 256;
/** Tiles along the longer side. */
const GRID = 12;
/** The sharpest tile against the median one: below it the photo is sharp all
 * over (a landscape, a group) and nothing in it stands out. */
export const FOCUS_FROM = 3;
/** Tiles at least this share of the sharpest one belong to the subject. */
const SUBJECT_SHARE = 0.45;

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
  const median = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)]!;
  const strength = median > 0 ? top / median : top > 0 ? Infinity : 0;
  if (!(strength >= FOCUS_FROM)) return null;

  let x0 = cols;
  let y0 = rows;
  let x1 = 0;
  let y1 = 0;
  scores.forEach((score, t) => {
    if (score < SUBJECT_SHARE * top) return;
    const cx = t % cols;
    const cy = Math.floor(t / cols);
    x0 = Math.min(x0, cx);
    y0 = Math.min(y0, cy);
    x1 = Math.max(x1, cx + 1);
    y1 = Math.max(y1, cy + 1);
  });
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    x: r((x0 * tile) / width),
    y: r((y0 * tile) / height),
    w: r(((x1 - x0) * tile) / width),
    h: r(((y1 - y0) * tile) / height),
    strength: Math.round(Math.min(strength, 9999) * 10) / 10,
  };
}
