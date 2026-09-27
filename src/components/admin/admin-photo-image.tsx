"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * An admin grid tile: the upload-time thumbnail when there is one — straight
 * from the bucket, never a transformation of the 14 MB original — and the
 * original after all if the thumbnail does not load. The confirm route records
 * a thumbnail on the client's word, so a failed thumbnail PUT must not leave
 * the photographer looking at an empty square (same fallback as the guest grid).
 */
export function AdminPhotoImage({
  objectKey,
  thumbObjectKey,
  alt,
}: {
  objectKey: string;
  thumbObjectKey: string | null;
  alt: string;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  return (
    <Image
      src={thumbObjectKey && !thumbFailed ? thumbObjectKey : objectKey}
      onError={() => setThumbFailed(true)}
      alt={alt}
      fill
      sizes="(max-width: 640px) 50vw, 200px"
      className="object-cover"
    />
  );
}
