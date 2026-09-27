import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrintQueue, type PrintSendOutcome } from "./print-queue";

const KEY = "gg.printQueue.test";

function deferred() {
  let resolve!: (outcome: PrintSendOutcome) => void;
  const promise = new Promise<PrintSendOutcome>((r) => (resolve = r));
  return { promise, resolve };
}

function listener() {
  return { saved: vi.fn(), refused: vi.fn(), changed: vi.fn() };
}

beforeEach(() => window.localStorage.clear());

describe("PrintQueue", () => {
  it("keeps a mark through a network failure and sends it on the next flush", async () => {
    const send = vi
      .fn<(photoId: string, quantity: number) => Promise<PrintSendOutcome>>()
      .mockResolvedValueOnce({ status: "retry" })
      .mockResolvedValueOnce({ status: "saved", quantity: 2 });
    const events = listener();
    const queue = new PrintQueue(KEY, send, events);

    queue.set("a", 2);
    await queue.flush();
    expect(queue.offline).toBe(true);
    expect(queue.size).toBe(1);
    expect(events.refused).not.toHaveBeenCalled();

    await queue.flush();
    expect(queue.offline).toBe(false);
    expect(queue.size).toBe(0);
    expect(events.saved).toHaveBeenCalledWith("a", 2, false);
  });

  it("survives a reload through localStorage", () => {
    new PrintQueue(KEY, vi.fn(), listener()).set("a", 3);
    expect(new PrintQueue(KEY, vi.fn(), listener()).entries()).toEqual([["a", 3]]);
  });

  it("sends one request per photo at a time and then the latest quantity", async () => {
    const first = deferred();
    const send = vi
      .fn<(photoId: string, quantity: number) => Promise<PrintSendOutcome>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ status: "saved", quantity: 0 });
    const events = listener();
    const queue = new PrintQueue(KEY, send, events);

    queue.set("a", 1);
    const flushed = queue.flush();
    queue.set("a", 0);
    void queue.flush(); // "a" is in flight, so this must not send a second request
    expect(send).toHaveBeenCalledTimes(1);

    first.resolve({ status: "saved", quantity: 1 });
    await flushed;
    expect(events.saved).toHaveBeenCalledWith("a", 1, true);
    expect(send).toHaveBeenLastCalledWith("a", 0);
    expect(queue.size).toBe(0);
  });

  it("drops a refused mark instead of retrying it forever", async () => {
    const events = listener();
    const queue = new PrintQueue(KEY, async () => ({ status: "refused" }), events);

    queue.set("a", 1);
    await queue.flush();
    expect(queue.size).toBe(0);
    expect(events.refused).toHaveBeenCalledWith("a", false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("ignores a corrupted stored queue", () => {
    window.localStorage.setItem(KEY, '[["a", 2], ["b", "x"], ["c", 500], 7]');
    expect(new PrintQueue(KEY, vi.fn(), listener()).entries()).toEqual([["a", 2]]);
  });
});
