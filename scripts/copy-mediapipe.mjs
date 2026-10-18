#!/usr/bin/env node
/**
 * Puts MediaPipe's WASM next to the app, so face detection in the admin never
 * fetches anything from a Google CDN (docs/SOCIAL-VIDEO.md §4). Runs on every
 * install (`postinstall`), so the copy always matches the pinned package.
 *
 * MediaPipe gives the blink score only (Face Landmarker); the faces themselves
 * come from YuNet (src/lib/social-video/face-finder.ts).
 *
 * Only the WASM comes from the package; the model is committed in
 * `public/vendor/mediapipe/models/` (it is not on npm):
 *
 *   face_landmarker.task  — storage.googleapis.com/mediapipe-models/face_landmarker/
 *                           face_landmarker/float16/1/face_landmarker.task
 *
 * The version is in the target path: the files are served immutable
 * (next.config.ts), so a new version must be a new URL.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "@mediapipe", "tasks-vision");

if (!existsSync(pkgDir)) {
  // An install that skipped optional work (or a partial one) — nothing to copy,
  // and the admin's detection will say it is unavailable rather than break.
  console.warn("[copy-mediapipe] @mediapipe/tasks-vision is not installed; skipping");
  process.exit(0);
}

const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const target = join(root, "public", "vendor", "mediapipe", version, "wasm");
mkdirSync(target, { recursive: true });
// The SIMD build and the fallback for browsers without SIMD; FilesetResolver
// picks one. The classic build, not the "module" one: detection runs in a
// worker (src/lib/social-video/face-worker.ts) that Turbopack starts as a
// classic worker, where MediaPipe loads its loader with importScripts.
for (const name of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  copyFileSync(join(pkgDir, "wasm", name), join(target, name));
}
console.log(`[copy-mediapipe] ${version} → public/vendor/mediapipe/${version}/wasm`);
