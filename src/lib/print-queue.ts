/**
 * Print marks that have not reached the server yet.
 *
 * Hearts and reactions are applied optimistically and walked back when the
 * request fails. That was fine for a heart and wrong for a print order: a
 * couple marks fifty photos on a phone at the venue or on a train, the signal
 * drops for a minute, and every mark made in that minute quietly reverts —
 * the admin then shows 28 where the bride counted 50. So print marks are
 * queued instead: the desired quantity per photo is kept (and persisted, so a
 * closed tab does not lose it) until the server confirms it, and resent when
 * the connection comes back. Only an actual refusal — expired link, photo
 * gone, printing turned off — drops a mark.
 *
 * One request per photo at a time, always carrying the latest quantity: the
 * API takes an absolute quantity, so two requests for the same photo racing
 * each other could otherwise land in the wrong order (tap +, tap −: the 1
 * arriving after the 0 leaves a photo marked that the viewer unmarked).
 */

export type PrintSendOutcome =
  | { status: "saved"; quantity: number }
  /** The server said no; resending the same thing will not help. */
  | { status: "refused" }
  /** Network down, timed out or a 5xx — keep it and try again later. */
  | { status: "retry" };

export interface PrintQueueListener {
  /** `superseded`: a newer quantity was queued while this one was in flight. */
  saved(photoId: string, quantity: number, superseded: boolean): void;
  refused(photoId: string, superseded: boolean): void;
  /** Anything `size`, `busy` or `offline` depend on may have changed. */
  changed(): void;
}

export class PrintQueue {
  private readonly pending: Map<string, number>;
  private readonly inFlight = new Set<string>();
  /** The last attempt failed for a reason worth retrying. */
  offline = false;

  constructor(
    private readonly storageKey: string,
    private readonly send: (photoId: string, quantity: number) => Promise<PrintSendOutcome>,
    private readonly listener: PrintQueueListener,
  ) {
    this.pending = new Map(readStored(storageKey));
  }

  /** Quantities still waiting for the server, for overlaying on its answer. */
  entries(): [string, number][] {
    return [...this.pending];
  }

  get size(): number {
    return this.pending.size;
  }

  get busy(): boolean {
    return this.inFlight.size > 0;
  }

  set(photoId: string, quantity: number): void {
    this.pending.set(photoId, quantity);
    this.persist();
    this.listener.changed();
  }

  /** Sends everything not already on its way; resolves once those settle. */
  flush(): Promise<void> {
    const sends: Promise<void>[] = [];
    for (const [photoId, quantity] of this.pending) {
      if (this.inFlight.has(photoId)) continue;
      this.inFlight.add(photoId);
      sends.push(this.sendOne(photoId, quantity));
    }
    if (sends.length > 0) this.listener.changed();
    return Promise.all(sends).then(() => undefined);
  }

  private async sendOne(photoId: string, quantity: number): Promise<void> {
    const outcome = await this.send(photoId, quantity).catch((): PrintSendOutcome => ({
      status: "retry",
    }));
    this.inFlight.delete(photoId);

    if (outcome.status === "retry") {
      this.offline = true;
      this.listener.changed();
      return;
    }

    this.offline = false;
    const superseded = this.pending.get(photoId) !== quantity;
    if (!superseded) {
      this.pending.delete(photoId);
      this.persist();
    }
    if (outcome.status === "saved") this.listener.saved(photoId, outcome.quantity, superseded);
    else this.listener.refused(photoId, superseded);
    this.listener.changed();

    // The viewer changed their mind while this was in flight — send that now.
    if (superseded) await this.flush();
  }

  private persist(): void {
    try {
      if (this.pending.size === 0) window.localStorage.removeItem(this.storageKey);
      else window.localStorage.setItem(this.storageKey, JSON.stringify([...this.pending]));
    } catch {
      // Storage blocked or full: the queue still works for this page's lifetime.
    }
  }
}

function readStored(storageKey: string): [string, number][] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        Number.isInteger(entry[1]) &&
        entry[1] >= 0 &&
        entry[1] <= 99,
    );
  } catch {
    return [];
  }
}
