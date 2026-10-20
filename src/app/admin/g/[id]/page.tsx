import {
  CHAPTER_TRANSLATED_FIELDS,
  GALLERY_TRANSLATED_FIELDS,
  parseTranslations,
} from "@/lib/content-translations";
import { formatDuration, videoSrc } from "@/lib/video";
import { VideoPosterPicker } from "@/components/admin/video-poster-picker";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { galleryCounts, photoCounts } from "@/lib/activity";
import { reactionTotals } from "@/lib/reactions";
import { printTotals, printTotalsByViewer } from "@/lib/print-selections";
import { printList } from "@/lib/print-export";
import { placeholderStyle } from "@/lib/placeholder";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { PrintDownloadButton } from "@/components/admin/print-download-button";
import { Uploader } from "@/components/uploader";
import { PhotoSelection } from "@/components/admin/photo-selection";
import { CopyButton } from "@/components/copy-button";
import { decryptToken } from "@/lib/token-cipher";
import { ShareLinkPanel } from "@/components/share-link-panel";
import { DeleteGalleryButton } from "@/components/delete-gallery-button";
import { UnpublishGalleryButton } from "@/components/unpublish-gallery-button";
import { GallerySettings } from "@/components/gallery-settings";
import { GalleryPromoPanel } from "@/components/admin/gallery-promo-panel";
import { GalleryChapterPanel, StartChapterDetails } from "@/components/admin/gallery-chapter-panel";
import { publishGallery, restoreGallery, setFeaturedVideo } from "../../actions";
import { startChapter } from "../../chapter-actions";
import { GalleryPhotoOrderPanel } from "@/components/admin/gallery-photo-order-panel";
import { GalleryHighlightPanel } from "@/components/admin/gallery-highlight-panel";
import { OpenGalleryLink } from "@/components/admin/open-gallery-link";
import { GalleryFaceScan } from "@/components/admin/gallery-face-scan";
import { currentFaces } from "@/lib/social-video/faces";
import { newestLiveShareUrl } from "@/lib/live-share-url";
import { MAX_PINNED, pickHighlights, toHighlightCandidate } from "@/lib/gallery-highlights";
import { chapterAnchor, compareTimeline } from "@/lib/gallery-chapters";
import {
  CHAPTER_START_SELECT,
  ORDER_KEY_SELECT,
  chapterStartOf,
  compareChapterStarts,
  PHOTO_ORDERS,
  photosOutOfPlace,
  positionOf,
  type PhotoOrder,
} from "@/lib/photo-order";
import { weaveTimes } from "@/lib/woven-order";
import { buildGridEntries, groupByChapter } from "@/lib/gallery-grid";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { PageHeader } from "@/components/ui/page-header";
import { galleryCrumbs } from "@/lib/admin-breadcrumbs";
import { GALLERY_STATUS } from "@/lib/gallery-status";
import { FORMS, pluralize } from "@/lib/czech-plural";
import {
  adminViewQuery,
  DEFAULT_VIEW,
  filterCounts,
  isFiltered,
  matchesAdminView,
  parseAdminView,
  sortAdminPhotos,
  type PhotoFacts,
} from "@/lib/admin-photo-filters";
import { parseSocialVideoDraft } from "@/lib/social-video/draft";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { PhotoCorrections } from "@/components/admin/photo-corrections";
import { cameraName } from "@/lib/upload-resume";

export const dynamic = "force-dynamic";

export default async function GalleryDetailPage(props: PageProps<"/admin/g/[id]">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in");

  const { id } = await props.params;
  // docs/ADMIN-FILTERS.md — filters and sort live in the URL.
  const view = parseAdminView(await props.searchParams);
  const printOnly = view.filters.includes("print");
  // docs/CHAPTERS.md — the photos in the guests' order, where chapters are set.
  const timelineView = view.sort === "order";

  const gallery = await prisma.gallery.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      eventDate: true,
      description: true,
      translations: true,
      status: true,
      trashedAt: true,
      eventId: true,
      coverPhotoId: true,
      featuredVideoId: true,
      highlightsEnabled: true,
      photoOrder: true,
      manualOrderAt: true,
      socialVideoDraft: true,
      people: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      // Only for the breadcrumb — a gallery hanging off a wedding routes through it.
      event: { select: { id: true, title: true } },
      photos: {
        where: { status: "CONFIRMED" },
        // Sorted below, once the gallery's order is known.
        select: {
          id: true,
          objectKey: true,
          // Every tile below prefers the upload-time thumbnail: served straight
          // from the bucket, it cannot fail the way transforming a 14 MB
          // original on first view occasionally does, and it is not billed.
          thumbObjectKey: true,
          // docs/VIDEO.md — a video tile shows its poster plus a badge.
          videoObjectKey: true,
          durationMs: true,
          placeholder: true,
          fileName: true,
          width: true,
          height: true,
          _count: { select: { favorites: true } },
          source: true,
          uploadedBy: { select: { displayName: true } },
          ...ORDER_KEY_SELECT,
          // docs/HIGHLIGHTS.md — the same pick the guests get.
          xmpRating: true,
          xmpLabel: true,
          xmpHighlight: true,
          highlightPin: true,
          faceTags: { select: { personId: true } },
          // docs/CORRECTIONS.md — the couple's corrections, oldest first.
          comments: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              body: true,
              x: true,
              y: true,
              resolvedAt: true,
              shareLinkId: true,
              shareLink: { select: { label: true } },
            },
          },
        },
      },
      chapters: {
        select: {
          id: true,
          title: true,
          translations: true,
          ...CHAPTER_START_SELECT,
          slug: true,
        },
      },
      shareLinks: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          label: true,
          expiresAt: true,
          revokedAt: true,
          passwordHash: true,
          allowDownload: true,
          allowReactions: true,
          allowPrintSelection: true,
          allowUpload: true,
          allowCorrections: true,
          correctionPinCipher: true,
          createdAt: true,
          slug: true,
          tokenCipher: true,
        },
      },
      promos: {
        orderBy: { slot: "asc" },
        select: {
          id: true,
          slot: true,
          enabled: true,
          promoCard: { select: { id: true, name: true, headline: true } },
        },
      },
    },
  });
  if (!gallery) notFound();
  // Most-loved first; ties — most of the gallery — in the guests' order.
  gallery.photos.sort(
    (a, b) =>
      b._count.favorites - a._count.favorites ||
      compareTimeline(positionOf(gallery.photoOrder, a), positionOf(gallery.photoOrder, b)),
  );

  // The whole card library, so the picker can offer one that is not placed
  // here yet — and so the panel can tell "no cards written" from "all of them
  // already placed", which are two different empty states.
  const promoCards = await prisma.promoCard.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  const [counts, perPhoto, reactions, printQuantities, printByViewer] = await Promise.all([
    galleryCounts(gallery.id),
    photoCounts(gallery.id),
    reactionTotals(gallery.id),
    printTotals(gallery.id),
    printOnly ? printTotalsByViewer(gallery.id) : [],
  ]);

  // Each link's copyable URL, decrypted once for both the share-link panel
  // and the chapters' "copy link" buttons.
  const shareLinks = gallery.shareLinks.map((link) => {
    const token = decryptToken(link.tokenCipher);
    return {
      ...link,
      url: token ? `/g/${token}/${link.slug ?? ""}` : null,
      correctionPin: decryptToken(link.correctionPinCipher),
    };
  });
  // Stills the face worker has not searched yet (docs/SOCIAL-VIDEO.md §4) —
  // searched on their own by GalleryFaceScan. Their stored faces are read only
  // here, to judge whether they are current.
  const facelessStills = (
    await prisma.photo.findMany({
      where: {
        galleryId: gallery.id,
        status: "CONFIRMED",
        videoObjectKey: null,
        width: { not: null },
        height: { not: null },
      },
      select: { id: true, objectKey: true, width: true, height: true, faces: true },
    })
  )
    .filter((photo) => currentFaces(photo.faces) === null)
    .map(({ id, objectKey, width, height }) => ({ id, objectKey, width: width!, height: height! }));

  // The gallery as a guest opens it — the header's "Otevřít galerii" and each
  // chapter's link (that plus its anchor).
  const now = new Date();
  const guestUrl = newestLiveShareUrl(shareLinks, gallery.status === "PUBLISHED", now);

  // Chapters are placed exactly as a guest's grid places them
  // (src/lib/gallery-grid.ts), over the photos in the gallery's order.
  const order = gallery.photoOrder;
  type AdminPhoto = (typeof gallery.photos)[number];
  const timelineOf = (photo: AdminPhoto) => positionOf(order, photo);
  const timeline = [...gallery.photos].sort((a, b) =>
    compareTimeline(timelineOf(a), timelineOf(b)),
  );
  const segments = groupByChapter(
    buildGridEntries(timeline, []),
    gallery.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      start: chapterStartOf(order, chapter),
      anchor: chapterAnchor(chapter),
      count: 0,
    })),
    timelineOf,
  );
  const photosOf = (entries: (typeof segments)[number]["entries"]) =>
    entries.flatMap((entry) => (entry.kind === "photo" ? [entry.photo] : []));
  const chapterSegments = new Map(
    segments.flatMap((segment) => (segment.chapter ? [[segment.chapter.id, segment]] : [])),
  );
  const adminChapters = gallery.chapters.toSorted(compareChapterStarts(order)).map((chapter) => {
    const chapterPhotos = photosOf(chapterSegments.get(chapter.id)?.entries ?? []);
    const first = chapterPhotos[0];
    return {
      id: chapter.id,
      anchor: chapterAnchor(chapter),
      title: chapter.title,
      translations: parseTranslations(chapter.translations, CHAPTER_TRANSLATED_FIELDS),
      count: chapterPhotos.length,
      firstPhoto: first
        ? {
            objectKey: first.objectKey,
            thumbObjectKey: first.thumbObjectKey,
            fileName: first.fileName,
          }
        : null,
    };
  });

  // The highlights exactly as a guest's page picks them (src/lib/shared-gallery.ts),
  // shown whether or not they are switched on, so they can be reviewed first.
  const highlightPicks = pickHighlights(
    // Photos only, exactly as the guests' strip (src/lib/shared-gallery.ts).
    gallery.photos
      .filter((photo) => !photo.videoObjectKey)
      .map((photo) => toHighlightCandidate(order, photo)),
    gallery.chapters.map((chapter) => chapterStartOf(order, chapter)),
  );
  const pickedPinned = new Map(highlightPicks.map((pick) => [pick.id, pick.pinned]));
  const pinnedCount = gallery.photos.filter((photo) => photo.highlightPin === true).length;
  const photosById = new Map(gallery.photos.map((photo) => [photo.id, photo]));
  const adminHighlights = highlightPicks.flatMap((pick) => {
    const photo = photosById.get(pick.id);
    return photo
      ? [
          {
            id: photo.id,
            objectKey: photo.objectKey,
            thumbObjectKey: photo.thumbObjectKey,
            fileName: photo.fileName,
            pinned: pick.pinned,
          },
        ]
      : [];
  });

  // docs/ADMIN-FILTERS.md — what each photo is, for the filters and sorts.
  const chapterOf = new Map(
    segments.flatMap((segment) =>
      segment.chapter
        ? photosOf(segment.entries).map((photo) => [photo.id, segment.chapter!.id] as const)
        : [],
    ),
  );
  const inVideoDraft = new Set(parseSocialVideoDraft(gallery.socialVideoDraft)?.order ?? []);
  const factsOf = (photo: AdminPhoto): PhotoFacts => {
    const stats = perPhoto.get(photo.id);
    return {
      id: photo.id,
      fileName: photo.fileName,
      fileOrderKey: photo.fileOrderKey,
      favorites: photo._count.favorites,
      reactions: reactions.get(photo.id) ?? 0,
      print: printQuantities.get(photo.id) ?? 0,
      comments: photo.comments.filter((comment) => comment.resolvedAt === null).length,
      views: stats?.views ?? 0,
      viewers: stats?.uniqueViewers ?? 0,
      highlight: pickedPinned.has(photo.id),
      inVideoDraft: inVideoDraft.has(photo.id),
      people: photo.faceTags.map((tag) => tag.personId),
      guest: photo.source === "GUEST",
      video: photo.videoObjectKey !== null,
      chapter: chapterOf.get(photo.id) ?? null,
    };
  };
  const facts = new Map(gallery.photos.map((photo) => [photo.id, factsOf(photo)]));
  const openCorrections = [...facts.values()].filter((fact) => fact.comments > 0).length;
  const shows = (photo: AdminPhoto) => matchesAdminView(view, facts.get(photo.id)!);
  // Most-loved (the order gallery.photos is in) unless another sort is picked.
  const visiblePhotos = sortAdminPhotos(
    view.sort,
    gallery.photos.filter(shows).map((photo) => ({ ...facts.get(photo.id)!, photo })),
  ).map((entry) => entry.photo);

  // The print summary covers what the view shows: narrowed by a person or a
  // chapter, the list, the copy and the download narrow with it.
  const printScoped =
    printOnly && isFiltered({ ...view, filters: view.filters.filter((f) => f !== "print") });
  const printMarkedPhotos = (printOnly ? visiblePhotos : gallery.photos).filter(
    (photo) => (printQuantities.get(photo.id) ?? 0) > 0,
  );
  const printItems = printMarkedPhotos.map((photo) => ({
    id: photo.id,
    fileName: photo.fileName,
    quantity: printQuantities.get(photo.id) ?? 0,
  }));
  const printPieces = printItems.reduce((sum, item) => sum + item.quantity, 0);

  /** The film above the highlights (docs/VIDEO.md §Featured film); pressing the current one clears it. */
  const featuredId = gallery.featuredVideoId;
  async function toggleFeaturedVideo(photoId: string) {
    "use server";
    await setFeaturedVideo(id, featuredId === photoId ? null : photoId);
  }

  async function publish() {
    "use server";
    await publishGallery(id);
  }

  /** One photo's admin tile. `startsChapter` is set in the timeline view on
   * the photo a chapter currently begins with. */
  const renderPhoto = (photo: AdminPhoto, startsChapter: string | null = null) => {
    const stats = perPhoto.get(photo.id) ?? { views: 0, uniqueViewers: 0 };
    const printQuantity = printQuantities.get(photo.id) ?? 0;
    const isCover = gallery.coverPhotoId === photo.id;
    const inHighlights = pickedPinned.has(photo.id);
    return (
      // content-visibility: a 600-photo gallery only lays out the rows on screen.
      <li
        key={photo.id}
        className="space-y-1 [contain-intrinsic-size:auto_220px] [content-visibility:auto]"
      >
        {/* The whole tile toggles the checkbox — the bar below holds the actions
            (src/components/admin/photo-selection.tsx). */}
        <label className="group has-focus-visible:outline-brand-primary bg-brand-tint relative block aspect-square cursor-pointer overflow-hidden rounded has-focus-visible:outline-2 has-focus-visible:-outline-offset-2">
          {/* Shrinks when selected, like Google Photos — the tint shows around it. */}
          <span
            className="absolute inset-0 overflow-hidden transition-transform duration-150 group-has-checked:scale-[0.86] group-has-checked:rounded"
            style={
              photo.placeholder
                ? { backgroundColor: placeholderStyle(photo.placeholder) }
                : undefined
            }
          >
            <AdminPhotoImage
              objectKey={photo.objectKey}
              thumbObjectKey={photo.thumbObjectKey}
              alt={photo.fileName}
              // Three columns on a phone, six on a desktop.
              sizes="(max-width: 640px) 33vw, 200px"
            />
          </span>
          {/* Drawn inside the tile: content-visibility clips anything outside it. */}
          <span
            aria-hidden
            className={`group-has-checked:ring-brand-primary pointer-events-none absolute inset-0 rounded ring-inset group-has-checked:ring-4 ${
              isCover ? "ring-brand-primary ring-2" : ""
            }`}
          />
          <input
            type="checkbox"
            name="photo"
            value={photo.id}
            data-cover={isCover ? "1" : undefined}
            data-pin={String(photo.highlightPin)}
            data-highlight={inHighlights ? "1" : undefined}
            aria-label={`Vybrat ${photo.fileName}`}
            // Shown on hover, on touch screens, and on every tile once
            // anything is selected — then a tap anywhere reads as "select".
            className="accent-brand-primary absolute top-2 left-2 size-5 cursor-pointer opacity-0 transition-opacity group-hover:opacity-100 checked:opacity-100 focus-visible:opacity-100 in-data-selecting:opacity-100 pointer-coarse:opacity-100"
          />
          {isCover && (
            <span className="bg-brand-primary text-caption absolute bottom-1 left-1 rounded-full px-2 py-0.5 font-semibold text-white">
              Titulní
            </span>
          )}
          {photo.videoObjectKey && (
            <span className="text-caption absolute right-1 bottom-1 rounded-full bg-black/60 px-2 py-0.5 font-semibold text-white tabular-nums">
              ▶ Video{photo.durationMs ? ` · ${formatDuration(photo.durationMs)}` : ""}
            </span>
          )}
          {inHighlights && (
            <span className="text-caption absolute top-1 right-1 rounded-full bg-white/90 px-2 py-0.5 font-semibold text-neutral-800">
              ★ Výběr
            </span>
          )}
        </label>
        {photo.videoObjectKey && (
          <form action={toggleFeaturedVideo.bind(null, photo.id)}>
            <button
              type="submit"
              aria-pressed={featuredId === photo.id}
              className={`text-caption min-h-8 w-full rounded-full px-2 font-semibold ${
                featuredId === photo.id
                  ? "bg-brand-primary text-white"
                  : "border-brand-border text-brand-ink dark:text-brand-tint border"
              }`}
            >
              {featuredId === photo.id ? "✓ Hlavní film" : "Nastavit jako hlavní film"}
            </button>
          </form>
        )}
        {photo.source === "GUEST" && (
          <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">
            Od hostů
            {photo.uploadedBy?.displayName && ` · ${photo.uploadedBy.displayName}`}
          </p>
        )}
        <p
          className="text-admin-muted text-xs tabular-nums dark:text-neutral-400"
          title={`${stats.views} zobrazení, ${stats.uniqueViewers} unikátních diváků`}
        >
          {stats.views} zobr. · {stats.uniqueViewers} unik.
          {photo._count.favorites > 0 && (
            <span className="text-rose-600"> · ♥ {photo._count.favorites}</span>
          )}
          {(reactions.get(photo.id) ?? 0) > 0 && (
            <span className="text-amber-600"> · {reactions.get(photo.id)} reakcí</span>
          )}
          {printQuantity > 0 && (
            <span className="text-brand-primary-dark"> · 🖨 {printQuantity}</span>
          )}
        </p>
        {printQuantity > 0 && <CopyButton value={photo.fileName} label="Kopírovat název souboru" />}
        {photo.comments.length > 0 && <PhotoCorrections photo={photo} comments={photo.comments} />}
        {photo.videoObjectKey && (
          <VideoPosterPicker
            photoId={photo.id}
            fileName={photo.fileName}
            videoUrl={videoSrc(photo.videoObjectKey)}
          />
        )}
        {timelineView && (
          <StartChapterDetails
            summary={startsChapter ? "Přejmenovat kapitolu" : "Tady začíná kapitola"}
            defaultTitle={startsChapter ?? undefined}
            action={startChapter.bind(null, gallery.id, photo.id)}
          />
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {gallery.trashedAt && (
        <Alert className="flex items-center justify-between">
          <p>Tato galerie je v koši a bude po uplynutí lhůty natrvalo smazána.</p>
          <form action={restoreGallery.bind(null, gallery.id)}>
            <Button type="submit" variant="secondary" size="sm">
              Obnovit
            </Button>
          </form>
        </Alert>
      )}

      <PageHeader
        title={gallery.title}
        crumbs={galleryCrumbs(gallery)}
        subtitle={`${GALLERY_STATUS[gallery.status].label} · ${pluralize(gallery.photos.length, FORMS.photo)}`}
        actions={
          <>
            {/* docs/SOCIAL-VIDEO.md — a Reel or a gift from this gallery's photos. */}
            <a href={`/admin/g/${gallery.id}/video`} className={buttonClasses("secondary", "md")}>
              Video pro sítě
            </a>
            {/* docs/SOCIAL-VIDEO.md §2 — both versions into the gallery, no editing. */}
            <a
              href={`/admin/g/${gallery.id}/video?gift=1`}
              className={buttonClasses("secondary", "md")}
            >
              Dárkové video
            </a>
            {/* docs/SOCIAL-VIDEO.md §4 — closed and soft eyes, before the couple sees them. */}
            <a href={`/admin/g/${gallery.id}/check`} className={buttonClasses("secondary", "md")}>
              Kontrola fotek
            </a>
            {/* docs/SOCIAL-VIDEO.md §4 — the couple named, for the video's and the projection's camera. */}
            <a href={`/admin/g/${gallery.id}/people`} className={buttonClasses("secondary", "md")}>
              Kdo je kdo
            </a>
            {/* docs/CORRECTIONS.md — only while the couple has asked for something. */}
            {openCorrections > 0 && (
              <a
                href={`/admin/g/${gallery.id}?f=comments`}
                className={buttonClasses("secondary", "md")}
              >
                Připomínky ({openCorrections})
              </a>
            )}
            <GallerySettings
              galleryId={gallery.id}
              title={gallery.title}
              eventDate={gallery.eventDate?.toISOString().slice(0, 10) ?? null}
              description={gallery.description}
              translations={parseTranslations(gallery.translations, GALLERY_TRANSLATED_FIELDS)}
            />
            {gallery.status === "DRAFT" && (
              <form action={publish}>
                <Button type="submit">Publikovat</Button>
              </form>
            )}
            {gallery.status === "PUBLISHED" && !gallery.trashedAt && (
              <UnpublishGalleryButton galleryId={gallery.id} />
            )}
            {!gallery.trashedAt && <DeleteGalleryButton galleryId={gallery.id} />}
            {/* The page's one primary action, last so it sits top right. */}
            {guestUrl && <OpenGalleryLink href={guestUrl} />}
          </>
        }
      />

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Zobrazení" value={counts.views} />
        <Stat label="Unikátní diváci" value={counts.uniqueViewers} />
        {printOnly ? (
          <>
            <Stat label="Fotek k tisku" value={printMarkedPhotos.length} />
            <Stat label="Kusů k tisku" value={printPieces} />
          </>
        ) : (
          <>
            <Stat label="Fotek" value={gallery.photos.length} />
            <Stat
              label="Aktivní odkazy"
              value={gallery.shareLinks.filter((l) => !l.revokedAt).length}
            />
          </>
        )}
      </section>

      <Uploader galleryId={gallery.id} />

      <GalleryFaceScan galleryId={gallery.id} missing={facelessStills} />

      <ShareLinkPanel
        galleryId={gallery.id}
        shareLinks={shareLinks}
        published={gallery.status === "PUBLISHED"}
        hostedByEvent={gallery.eventId !== null}
      />

      <GalleryPromoPanel
        galleryId={gallery.id}
        photoCount={gallery.photos.length}
        placed={gallery.promos.map((placement) => ({
          placementId: placement.id,
          promoCardId: placement.promoCard.id,
          name: placement.promoCard.name,
          headline: placement.promoCard.headline,
          slot: placement.slot,
          enabled: placement.enabled,
        }))}
        available={promoCards}
      />

      <GalleryPhotoOrderPanel
        galleryId={gallery.id}
        order={order}
        displaced={displacedByOrder(order, gallery.photos)}
        arrangedBefore={gallery.manualOrderAt !== null}
        takesGuestPhotos={
          gallery.shareLinks.some((link) => link.allowUpload && !link.revokedAt) ||
          gallery.photos.some((photo) => photo.source === "GUEST")
        }
      />

      <GalleryChapterPanel
        chapters={adminChapters}
        shareUrl={guestUrl}
        timelineHref={`/admin/g/${gallery.id}` + adminViewQuery({ ...view, sort: "order" })}
        timelineActive={timelineView}
      />

      <GalleryHighlightPanel
        galleryId={gallery.id}
        enabled={gallery.highlightsEnabled}
        highlights={adminHighlights}
        excludedCount={gallery.photos.filter((photo) => photo.highlightPin === false).length}
        pinnedCount={pinnedCount}
        ownCount={gallery.photos.filter((photo) => photo.source === "OWNER").length}
      />

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="mb-0">Fotky — zobrazení a unikátní diváci</CardTitle>
          {!printOnly && (
            <p className="text-admin-muted text-caption dark:text-neutral-400">
              {gallery.coverPhotoId
                ? "Titulní fotka je vybraná ručně."
                : "Bez vybrané titulní fotky se použije ta naposledy nahraná."}
            </p>
          )}
        </div>
        <AdminFilterBar
          key={adminViewQuery(view)}
          view={view}
          counts={filterCounts(view, [...facts.values()])}
          shown={visiblePhotos.length}
          total={gallery.photos.length}
          people={gallery.people}
          chapters={adminChapters.map((chapter) => ({ id: chapter.id, title: chapter.title }))}
        />
        {view.filters.includes("comments") && visiblePhotos.length > 0 && (
          <div className="border-admin-border text-body mt-3 space-y-2 rounded-lg border p-3 dark:border-neutral-800">
            <p>
              Fotky s otevřenou připomínkou: <strong>{visiblePhotos.length}</strong>. Po nahrání
              opravené fotky se její připomínky vyřídí samy.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* Camera numbers, for finding the shots in Lightroom's text filter. */}
              <CopyButton
                value={visiblePhotos.map((photo) => cameraName(photo.fileName)).join(" ")}
                label="Kopírovat čísla z fotoaparátu"
                text="Čísla pro Lightroom"
              />
              <CopyButton
                value={visiblePhotos
                  .flatMap((photo) =>
                    photo.comments
                      .filter((comment) => comment.resolvedAt === null)
                      .map((comment) => `${photo.fileName}: ${comment.body}`),
                  )
                  .join("\n")}
                label="Kopírovat připomínky jako text"
                text="Připomínky jako text"
              />
            </div>
          </div>
        )}
        {printOnly && printItems.length > 0 && (
          <div className="border-admin-border text-body mt-3 space-y-2 rounded-lg border p-3 dark:border-neutral-800">
            <p>
              Fotky k tisku: <strong>{printMarkedPhotos.length}</strong>, kusů celkem:{" "}
              <strong>{printPieces}</strong>.
            </p>
            {/* Totals add up every guest's marks; this says whose they are. */}
            <ul className="text-caption">
              {!printScoped &&
                printByViewer.map((row) => (
                  <li key={row.viewerId}>
                    {row.displayName ?? "Bez jména"}: fotky {row.photos} · {row.pieces} ks
                  </li>
                ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <PrintDownloadButton
                galleryId={gallery.id}
                count={printMarkedPhotos.length}
                photoIds={printScoped ? printMarkedPhotos.map((photo) => photo.id) : undefined}
              />
              <CopyButton
                value={printList(printItems)}
                label="Kopírovat seznam souborů s počty kusů"
                text="Seznam"
              />
            </div>
            <p className="text-admin-muted text-caption dark:text-neutral-400">
              Originály se stáhnou jeden po druhém do Stažených souborů, u více kusů s počtem v
              názvu (<code>5x_…</code>). Prohlížeč se napoprvé zeptá, jestli povolit stažení více
              souborů — povol.
            </p>
          </div>
        )}
        <p className="text-admin-muted text-caption mt-1 dark:text-neutral-400">
          Klepnutím fotku vyberete
          <span className="pointer-coarse:hidden">, se Shiftem celý úsek</span>. Akce se objeví
          dole.
        </p>
        <PhotoSelection galleryId={gallery.id} pinnedCount={pinnedCount} maxPinned={MAX_PINNED}>
          <ul className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
            {timelineView
              ? segments.map((segment) => {
                  const segmentPhotos = photosOf(segment.entries).filter(shows);
                  // A filtered view hides a chapter with nothing left in it.
                  if (segmentPhotos.length === 0 && isFiltered(view)) return [];
                  return [
                    segment.chapter && (
                      <li
                        key={`chapter:${segment.chapter.id}`}
                        className="border-brand-border col-span-full mt-3 flex items-baseline justify-between gap-3 border-b pb-1 first:mt-0 dark:border-neutral-700"
                      >
                        <h3 className="text-brand-ink text-lg font-semibold dark:text-neutral-100">
                          {segment.chapter.title}
                        </h3>
                        <span className="text-admin-muted text-xs dark:text-neutral-400">
                          {segmentPhotos.length} fotek
                        </span>
                      </li>
                    ),
                    ...segmentPhotos.map((photo, i) =>
                      renderPhoto(photo, segment.chapter && i === 0 ? segment.chapter.title : null),
                    ),
                  ];
                })
              : visiblePhotos.map((photo) => renderPhoto(photo))}
          </ul>
        </PhotoSelection>
        {visiblePhotos.length === 0 && (
          <p className="text-admin-muted text-body mt-3 dark:text-neutral-400">
            {gallery.photos.length === 0 ? (
              "Zatím žádné potvrzené fotky."
            ) : (
              <>
                Žádná fotka neodpovídá filtrům.{" "}
                <a
                  href={`/admin/g/${gallery.id}${adminViewQuery({ ...DEFAULT_VIEW, sort: view.sort })}`}
                  className="underline"
                >
                  Zrušit filtry
                </a>
              </>
            )}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * How many photos each order would move from the current one — tells the
 * photographer whether switching would change anything here. The woven order
 * is computed on the spot rather than read from `wovenAt`, which is only kept
 * while a gallery uses it.
 */
function displacedByOrder(
  current: PhotoOrder,
  photos: readonly (Parameters<typeof positionOf>[1] & { source: "OWNER" | "GUEST" })[],
): Record<PhotoOrder, number> {
  const woven = weaveTimes(
    photos.map((photo) => ({
      id: photo.id,
      source: photo.source,
      fileOrderKey: photo.fileOrderKey,
      capturedAt: photo.takenAt ?? photo.createdAt,
    })),
  );
  const inOrder = (order: PhotoOrder) =>
    photos
      .map((photo) =>
        positionOf(order, { ...photo, wovenAt: woven.get(photo.id) ?? photo.wovenAt }),
      )
      .sort(compareTimeline)
      .map((position) => position.id);
  const reference = inOrder(current);
  return Object.fromEntries(
    PHOTO_ORDERS.map((order) => [order, photosOutOfPlace(reference, inOrder(order))]),
  ) as Record<PhotoOrder, number>;
}
