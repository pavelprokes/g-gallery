/**
 * Rejects if the work has not finished in time.
 *
 * The failure worth defending against is rarely an exception — it is a worker,
 * a database or a request that never answers. Without a limit the `await`
 * simply never returns, and the person waiting sees nothing at all happen,
 * which is the least debuggable outcome there is.
 *
 * The original promise is left to settle on its own: there is nothing to
 * cancel, and nothing reads it afterwards.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
