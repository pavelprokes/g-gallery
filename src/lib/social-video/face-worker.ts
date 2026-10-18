// The face worker (docs/SOCIAL-VIDEO.md §4): photos in as compressed bytes,
// faces out. Decoding and detection both happen here, so a gallery of 400
// photos is searched without freezing the admin's page. One photo at a time,
// in the order asked; detect.ts is the page's side.

import { createFaceFinderCore, type FaceFinderCore } from "@/lib/social-video/face-finder";
import type { FaceReply, FaceRequest } from "@/lib/social-video/detect";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FaceRequest>) => void) | null;
  postMessage(reply: FaceReply): void;
};

/** Created on the first photo; a failed start is tried again on the next. */
let finder: Promise<FaceFinderCore> | null = null;
let queue: Promise<void> = Promise.resolve();

scope.onmessage = ({ data: { id, photo } }) => {
  queue = queue.then(async () => {
    try {
      finder ??= createFaceFinderCore().catch((cause: unknown) => {
        finder = null;
        throw cause;
      });
      const core = await finder;
      const image = await createImageBitmap(photo);
      try {
        scope.postMessage({ id, faces: await core.find(image) });
      } finally {
        image.close();
      }
    } catch (cause) {
      scope.postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) });
    }
  });
};
