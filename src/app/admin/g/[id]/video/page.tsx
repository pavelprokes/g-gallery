import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { CHAPTER_START_SELECT, chapterStartOf } from "@/lib/photo-order";
import { parseSocialVideoDraft } from "@/lib/social-video/draft";
import {
  STUDIO_PHOTO_SELECT,
  STUDIO_PHOTO_WHERE,
  toStudioPhotos,
} from "@/lib/social-video/studio-photos";
import { galleryVideoCrumbs } from "@/lib/admin-breadcrumbs";
import { GiftVideoCard } from "@/components/admin/gift-video-card";
import { SocialVideoStudio } from "@/components/admin/social-video-studio";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * A short silent video from the gallery, for Reels and Stories or as the
 * couple's gift (docs/SOCIAL-VIDEO.md). Everything heavy — fetching, faces,
 * frames, encoding — happens in the photographer's browser; this page only
 * hands it the photos.
 */
export default async function SocialVideoPage(props: PageProps<"/admin/g/[id]/video">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const { id } = await props.params;
  const gallery = await prisma.gallery.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      photoOrder: true,
      socialVideoDraft: true,
      event: { select: { id: true, title: true } },
      chapters: { select: CHAPTER_START_SELECT },
      photos: { where: STUDIO_PHOTO_WHERE, select: STUDIO_PHOTO_SELECT },
    },
  });
  if (!gallery) notFound();

  const order = gallery.photoOrder;
  const photos = await toStudioPhotos(gallery.id, order, gallery.photos);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Video pro sítě"
        crumbs={galleryVideoCrumbs(gallery)}
        subtitle="Krátké video bez zvuku a titulků — na výšku pro Reels a Stories, na šířku pro web."
      />
      {photos.length < 2 ? (
        <Alert>Na video jsou potřeba aspoň dvě fotky. Nahraj je v detailu galerie.</Alert>
      ) : (
        <>
          <GiftVideoCard
            galleryId={gallery.id}
            galleryTitle={gallery.title}
            photos={photos}
            chapterStarts={gallery.chapters.map((chapter) => chapterStartOf(order, chapter))}
            autoStart={(await props.searchParams).gift === "1"}
          />
          <SocialVideoStudio
            galleryId={gallery.id}
            galleryTitle={gallery.title}
            photos={photos}
            chapterStarts={gallery.chapters.map((chapter) => chapterStartOf(order, chapter))}
            savedDraft={parseSocialVideoDraft(gallery.socialVideoDraft)}
          />
        </>
      )}
    </div>
  );
}
