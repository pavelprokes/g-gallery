import type { Metadata } from "next";
import type { PhotoStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { pickCover } from "@/lib/event-access";

const galleryCoverSelect = {
  title: true,
  coverPhoto: { select: { objectKey: true, status: true } },
  photos: {
    where: { status: "CONFIRMED" as PhotoStatus },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { objectKey: true, status: true },
  },
} as const;

function ogImageUrl(objectKey: string): string | undefined {
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "");
  if (!base) return undefined;
  return `${base}/${objectKey}`;
}

export async function galleryShareMetadata(
  galleryId: string,
  t: (key: string) => string,
): Promise<Metadata> {
  const gallery = await prisma.gallery.findUnique({
    where: { id: galleryId },
    select: galleryCoverSelect,
  });

  const title = gallery?.title ?? t("untitledPlaceholder");
  const description = t("galleryOgDescription");
  const cover = pickCover(gallery?.coverPhoto, gallery?.photos[0]);
  const imageUrl = cover ? ogImageUrl(cover.objectKey) : undefined;

  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      images: imageUrl ? [{ url: imageUrl }] : [],
    },
  };
}

export function eventShareMetadata(
  title: string,
  coverObjectKey: string | undefined,
  t: (key: string) => string,
): Metadata {
  const description = t("galleryOgDescription");
  const imageUrl = coverObjectKey ? ogImageUrl(coverObjectKey) : undefined;

  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      images: imageUrl ? [{ url: imageUrl }] : [],
    },
  };
}
