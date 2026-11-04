// Pure pieces of the guest's corrections mode (docs/CORRECTIONS.md), kept out
// of the components so they can be tested on their own.

/**
 * The PIN out of whatever landed in the field. Typed digits are taken as they
 * come, up to six. A paste may carry the admin's whole copied line ("PIN pro
 * připomínky k fotkám: 123456") or a spaced PIN ("123 456"): a run of exactly
 * six digits wins (the last one, as the PIN ends that line), otherwise the
 * last six digits of the lot.
 */
export function pinFromInput(value: string): string {
  if (/^\d*$/.test(value)) return value.slice(0, 6);
  const runs = value.match(/\d+/g) ?? [];
  const six = runs.filter((run) => run.length === 6);
  if (six.length > 0) return six[six.length - 1]!;
  return runs.join("").slice(-6);
}

/**
 * Where the corrections bar sticks. Under the chapter bar when there is one
 * (as the print summary does), and under the print summary when that is
 * showing too, so the two pills never sit on the same spot. The summary is a
 * line or two, a line more when others print as well.
 */
export function correctionsBarTop({
  belowChapters,
  printSummary,
}: {
  belowChapters: boolean;
  printSummary: "none" | "short" | "tall";
}): string {
  const base = belowChapters ? "4rem" : "0.5rem";
  if (printSummary === "none") return base;
  return `calc(${base} + ${printSummary === "tall" ? "6rem" : "4.5rem"})`;
}

/**
 * A comment typed but not yet sent, per gallery and photo, for this tab only:
 * it outlives a swipe to the next photo and a session that ran out, and goes
 * once the comment is saved. Storage can be off (private mode, quota) — then
 * a draft simply lives as long as the panel.
 */
export function correctionDraftKey(galleryId: string, photoId: string): string {
  return `gg.correctionDraft.${galleryId}.${photoId}`;
}

export function readCorrectionDraft(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeCorrectionDraft(key: string, text: string): void {
  try {
    if (text.trim()) window.sessionStorage.setItem(key, text);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage unavailable: the draft lives in the panel only.
  }
}
