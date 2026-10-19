import Image from "next/image";
import type { Box } from "@/lib/social-video/face-tags";

/**
 * A face cut out of its photo, `size` px square: the whole photo through the
 * image loader (CLAUDE.md invariant #1), scaled so the face fills the middle
 * and the rest is clipped — no crop of its own on the CDN.
 */
export function FaceZoom({
  photo,
  face,
  size = 128,
  alt,
}: {
  photo: { objectKey: string; fileName: string; width: number; height: number };
  face: Box;
  size?: number;
  alt?: string;
}) {
  const side = Math.max(face.w * photo.width, face.h * photo.height) * 1.6;
  const k = size / side;
  const width = Math.round(photo.width * k);
  const height = Math.round(photo.height * k);
  return (
    <div
      className="bg-brand-tint relative shrink-0 overflow-hidden rounded"
      style={{ width: size, height: size }}
    >
      <Image
        src={photo.objectKey}
        alt={alt ?? `Tvář na fotce ${photo.fileName}`}
        width={width}
        height={height}
        sizes={`${width}px`}
        className="absolute max-w-none"
        style={{
          left: Math.round(size / 2 - (face.x + face.w / 2) * photo.width * k),
          top: Math.round(size / 2 - (face.y + face.h / 2) * photo.height * k),
        }}
      />
    </div>
  );
}
