/**
 * A random identifier that works outside a secure context.
 *
 * `crypto.randomUUID()` is only defined on secure origins. `https://` and
 * `localhost` qualify; **a LAN IP over plain http does not** — which is exactly
 * how the app gets tested from a phone on the same wifi. Calling it there
 * throws, and the throw is what made a picked photo do nothing at all.
 *
 * `crypto.getRandomValues()` has no such restriction, so it does the work
 * wherever it exists. The last resort is not cryptographically strong and does
 * not need to be: these ids key rows in the viewer's own browser storage. They
 * must not collide. They protect nothing.
 */
export function randomId(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

    if (typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      // RFC 4122 version 4 layout, so the value is indistinguishable from what
      // randomUUID would have produced.
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }

  // No crypto at all. Time plus randomness, which cannot collide within one
  // browser in any way that matters here.
  const rand = () => Math.random().toString(16).slice(2, 10).padStart(8, "0");
  return `${Date.now().toString(16).padStart(12, "0").slice(-12)}-${rand()}-${rand()}`;
}
