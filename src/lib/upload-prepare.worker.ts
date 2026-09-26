import { prepareUpload } from "@/lib/upload-prepare";

/**
 * The upload worker (docs/AUDIT.md §3.6). Stripping GPS, hashing and decoding
 * a 12 MB photo is a few hundred milliseconds of solid work per file; on the
 * main thread of a mid-range phone that is the page freezing while a guest
 * watches the progress ring, forty times over. Here it is only the worker
 * that is busy.
 *
 * A File crosses into a worker by reference — no bytes are copied — and the
 * resulting Blob comes back the same way.
 */
interface Request {
  id: number;
  file: File;
}

// Typed locally rather than through `lib: ["webworker"]`, which would clash
// with the DOM lib every other file in this project compiles against.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown) => void;
};

// One file at a time, even if the page ever sends two: interleaving at every
// await would hold several full-resolution decodes in one thread's memory.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const { id, file } = event.data;
  queue = queue.then(() =>
    prepareUpload(file).then(
      (result) => scope.postMessage({ id, ok: true, result }),
      (error: unknown) =>
        scope.postMessage({
          id,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        }),
    ),
  );
};
