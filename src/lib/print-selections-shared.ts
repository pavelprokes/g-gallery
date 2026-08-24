/**
 * Print-quantity cycling logic shared by the browser and the server.
 *
 * Deliberately free of `server-only` and of any Prisma import — the gallery is
 * a Client Component, and pulling the server module in would drag the
 * database client into the browser bundle.
 */

export const MAX_PRINT_QUANTITY = 99;

/** What a single click on the printer icon does: +1, wrapping 99 back to 0. */
export function nextPrintQuantity(current: number): number {
  return current >= MAX_PRINT_QUANTITY ? 0 : current + 1;
}
