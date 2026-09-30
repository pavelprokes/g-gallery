"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * An admin grid tile: the upload-time thumbnail when there is one — straight
 * from the bucket, never a transformation of the 14 MB original — and the
 * original after all if the thumbnail does not load. The confirm route records
 * a thumbnail on the client's word, so a failed thumbnail PUT must not leave
 * the photographer looking at an empty square (same fallback as the guest grid).
 * If the original fails too, the image is dropped, so the tile shows whatever
 * sits behind it (placeholder colour) instead of a broken-image icon.
 */
export function AdminPhotoImage({
  objectKey,
  thumbObjectKey,
  alt,
  sizes = "(max-width: 640px) 50vw, 200px",
}: {
  objectKey: string;
  thumbObjectKey: string | null;
  alt: string;
  sizes?: string;
}) {
  const [failed, setFailed] = useState<"none" | "thumb" | "all">("none");
  const useThumb = !!thumbObjectKey && failed === "none";
  if (failed === "all") return null;
  return (
    <Image
      src={useThumb ? thumbObjectKey : objectKey}
      onError={() => setFailed(useThumb ? "thumb" : "all")}
      alt={alt}
      fill
      sizes={sizes}
      className="object-cover"
    />
  );
}
