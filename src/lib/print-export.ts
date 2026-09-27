/**
 * What the photographer takes from the admin's print filter to the lab: a
 * readable list, and a Terminal command that copies the chosen files out of
 * the local export folder into `tisk/`, a copy count in the name when it is
 * more than one ("5x_svatba_0170.jpg").
 *
 * File names are partly guest-controlled (guest uploads), and the command is
 * pasted into a shell — so every name is reduced to a bare basename without
 * control characters. With no newline in a name, nothing can end the quoted
 * heredoc early, and the heredoc's quoted delimiter means nothing in it is
 * ever expanded.
 */

export interface PrintItem {
  fileName: string;
  quantity: number;
}

function safeName(fileName: string): string {
  const clean = fileName.replace(/[\u0000-\u001f\u007f]/g, "");
  return clean.slice(clean.lastIndexOf("/") + 1);
}

function cleanItems(items: PrintItem[]): PrintItem[] {
  return items
    .map((item) => ({ fileName: safeName(item.fileName), quantity: item.quantity }))
    .filter(
      (item) =>
        item.fileName && item.fileName !== "." && item.fileName !== ".." && item.quantity > 0,
    )
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** "svatba_0170__U0A1551.jpg — 5 ks", one line per photo, by file name. */
export function printList(items: PrintItem[]): string {
  return cleanItems(items)
    .map((item) => `${item.fileName} — ${item.quantity} ks`)
    .join("\n");
}

/** Run in Terminal from inside the folder with the exported photos (zsh or bash). */
export function printCopyCommand(items: PrintItem[]): string {
  const lines = cleanItems(items).map((item) => `${item.quantity}\t${item.fileName}`);
  return [
    `mkdir -p tisk && while IFS=$'\\t' read -r q f; do`,
    `  n="$f"; [ "$q" -gt 1 ] && n="\${q}x_$f"`,
    `  if [ -f "$f" ]; then cp -n -- "$f" "tisk/$n"; else echo "Chybí: $f"; fi`,
    `done <<'SEZNAM'`,
    ...lines,
    `SEZNAM`,
  ].join("\n");
}
