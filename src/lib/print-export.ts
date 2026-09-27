/**
 * What the photographer takes from the admin's print filter to the lab: the
 * name each chosen photo is downloaded under — the copy count in front when it
 * is more than one ("5x_svatba_0170.jpg") — and a list using the very same
 * names, so list and folder match line for line.
 *
 * File names are partly guest-controlled (guest uploads) and end up in a
 * Content-Disposition header and on disk, so every name is reduced to a bare
 * basename without control characters first. Several phones produce the same
 * "IMG_0001.jpg", so a name that repeats gets the photo's id appended — a
 * browser's own " (1)" suffix would leave nobody knowing which file is which.
 */

export interface PrintItem {
  id: string;
  fileName: string;
  quantity: number;
}

export interface PrintEntry {
  id: string;
  name: string;
  quantity: number;
}

function safeName(fileName: string): string {
  const clean = fileName.replace(/[\u0000-\u001f\u007f]/g, "");
  const base = clean.slice(clean.lastIndexOf("/") + 1);
  return base === "." || base === ".." ? "" : base;
}

function withSuffix(name: string, suffix: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}_${suffix}${name.slice(dot)}` : `${name}_${suffix}`;
}

/** Every item with a positive quantity, named for download, sorted by original name. */
export function printEntries(items: PrintItem[]): PrintEntry[] {
  const chosen = items
    .filter((item) => item.quantity > 0)
    .map((item) => ({ ...item, base: safeName(item.fileName) || `foto_${item.id}.jpg` }))
    .sort((a, b) => a.base.localeCompare(b.base) || a.id.localeCompare(b.id));

  const seen = new Map<string, number>();
  for (const item of chosen) seen.set(item.base, (seen.get(item.base) ?? 0) + 1);

  return chosen.map((item) => {
    const unique = (seen.get(item.base) ?? 0) > 1 ? withSuffix(item.base, item.id) : item.base;
    const name = item.quantity > 1 ? `${item.quantity}x_${unique}` : unique;
    return { id: item.id, name, quantity: item.quantity };
  });
}

/** "5x_svatba_0170__U0A1551.jpg — 5 ks", one line per photo. */
export function printList(items: PrintItem[]): string {
  return printEntries(items)
    .map((entry) => `${entry.name} — ${entry.quantity} ks`)
    .join("\n");
}
