/**
 * What the photographer takes from the admin's print filter to the lab: a
 * readable list, and the name each chosen photo is downloaded under — with
 * the copy count in front when it is more than one ("5x_svatba_0170.jpg").
 *
 * File names are partly guest-controlled (guest uploads) and end up in a
 * Content-Disposition header and on disk, so every name is reduced to a bare
 * basename without control characters first.
 */

export interface PrintItem {
  fileName: string;
  quantity: number;
}

function safeName(fileName: string): string {
  const clean = fileName.replace(/[\u0000-\u001f\u007f]/g, "");
  const base = clean.slice(clean.lastIndexOf("/") + 1);
  return base === "." || base === ".." ? "" : base;
}

/** The name a chosen photo is saved under, or null if nothing usable is left of it. */
export function printFileName(item: PrintItem): string | null {
  const name = safeName(item.fileName);
  if (!name || item.quantity <= 0) return null;
  return item.quantity > 1 ? `${item.quantity}x_${name}` : name;
}

/** "svatba_0170__U0A1551.jpg — 5 ks", one line per photo, by file name. */
export function printList(items: PrintItem[]): string {
  return items
    .map((item) => ({ name: safeName(item.fileName), quantity: item.quantity }))
    .filter((item) => item.name && item.quantity > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => `${item.name} — ${item.quantity} ks`)
    .join("\n");
}
