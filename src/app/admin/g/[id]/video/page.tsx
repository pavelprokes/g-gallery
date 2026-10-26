import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { compareTimeline } from "@/lib/gallery-chapters";
import { HIGHLIGHT_CANDIDATE_SELECT, toHighlightCandidate } from "@/lib/gallery-highlights";
import { CHAPTER_START_SELECT, chapterStartOf, positionOf } from "@/lib/photo-order";
import { parseSocialVideoDraft } from "@/lib/social-video/draft";
import { faceless, needsFocus } from "@/lib/social-video/aim";
import { currentFaces } from "@/lib/social-video/faces";
import { likedScore } from "@/lib/social-video/suggest";
import { photoCounts } from "@/lib/activity";
import { printTotals } from "@/lib/print-selections";
import { reactionTotals } from "@/lib/reactions";
import { galleryVideoCrumbs } from "@/lib/admin-breadcrumbs";
import { GiftVideoCard } from "@/components/admin/gift-video-card";
import { SocialVideoStudio, type StudioPhoto } from "@/components/admin/social-video-studio";
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
      photos: {
        // Stills with a known size: the camera is planned in the photo's own
        // pixels before it is fetched. Films are not slides.
        where: {
          status: "CONFIRMED",
          videoObjectKey: null,
          width: { not: null },
          height: { not: null },
        },
        select: {
          ...HIGHLIGHT_CANDIDATE_SELECT,
          objectKey: true,
          thumbObjectKey: true,
          fileName: true,
          width: true,
          height: true,
          placeholder: true,
          faces: true,
          faceTags: {
            where: { person: { couple: true } },
            select: { x: true, y: true, w: true, h: true },
          },
          _count: { select: { favorites: true } },
        },
      },
    },
  });
  if (!gallery) notFound();

  // What the guests took to (docs/SOCIAL-VIDEO.md §3) — the same tallies the
  // gallery's own admin page shows.
  const [viewers, reactions, prints] = await Promise.all([
    photoCounts(gallery.id),
    reactionTotals(gallery.id),
    printTotals(gallery.id),
  ]);

  const order = gallery.photoOrder;
  const photos: StudioPhoto[] = gallery.photos
    .toSorted((a, b) => compareTimeline(positionOf(order, a), positionOf(order, b)))
    .map((photo) => ({
      id: photo.id,
      objectKey: photo.objectKey,
      thumbObjectKey: photo.thumbObjectKey,
      fileName: photo.fileName,
      placeholder: photo.placeholder,
      candidate: {
        ...toHighlightCandidate(order, photo),
        width: photo.width,
        height: photo.height,
        // A faceless photo is unknown to the studio until its sharp part is
        // looked for, so its own scan fills it in (docs/SOCIAL-VIDEO.md §5).
        // Soft-faced ones keep their faces here; the gallery page's scan
        // adds their focus without the suggestion losing them meanwhile.
        faces: ((f) => (f && faceless(f) && needsFocus(f) ? null : f))(currentFaces(photo.faces)),
        coupleTags: photo.faceTags,
        liked: likedScore({
          favorites: photo._count.favorites,
          reactions: reactions.get(photo.id) ?? 0,
          printCopies: prints.get(photo.id) ?? 0,
          uniqueViewers: viewers.get(photo.id)?.uniqueViewers ?? 0,
        }),
      },
    }));

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
