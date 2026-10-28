import { redirect } from "next/navigation";
import { z } from "zod";
import { getAdminSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { reelsCrumbs } from "@/lib/admin-breadcrumbs";
import { CHAPTER_START_SELECT, chapterStartOf } from "@/lib/photo-order";
import {
  STUDIO_PHOTO_SELECT,
  STUDIO_PHOTO_WHERE,
  toStudioPhotos,
} from "@/lib/social-video/studio-photos";
import { MAX_REEL_GALLERIES } from "@/lib/reels/sources";
import { metaConfigured } from "@/lib/instagram/config";
import { instagramStatus } from "@/lib/instagram/connection";
import { ReelSourcePicker, type PickerGroup } from "@/components/admin/reel-source-picker";
import { ReelStudio, type ReelGallery } from "@/components/admin/reel-studio";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

const galleryIds = z
  .string()
  .transform((value) => [...new Set(value.split(",").filter(Boolean))])
  .pipe(z.array(z.string().min(1).max(64)).max(MAX_REEL_GALLERIES))
  .catch([]);

/**
 * A vertical reel cut to music from one or more weddings (docs/REELS.md) —
 * published galleries only: what the guests have seen is what the reel
 * shows, and their prints and views pick the photos. The
 * galleries are chosen in the address (`?g=`), the music and everything heavy
 * — the beat, the frames, the encoding — stay in the photographer's browser.
 */
export default async function ReelsPage(props: PageProps<"/admin/reels">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin/reels");
  const ownerId = session.user.id;

  const search = await props.searchParams;
  const raw = search.g;
  const selected = galleryIds.parse(typeof raw === "string" ? raw : "");
  // What the Instagram sign-in just did (src/app/api/instagram/callback).
  const outcome =
    z
      .string()
      .regex(/^[a-z-]{1,32}$/)
      .catch("")
      .parse(search.instagram) || null;

  const usable = { _count: { select: { photos: { where: STUDIO_PHOTO_WHERE } } } } as const;
  const [events, standalone, chosen, instagramAccount] = await Promise.all([
    prisma.event.findMany({
      where: { ownerId, trashedAt: null },
      orderBy: [{ eventDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        eventDate: true,
        galleries: {
          where: { trashedAt: null, status: "PUBLISHED" },
          orderBy: [{ position: "asc" }, { title: "asc" }],
          select: { id: true, title: true, ...usable },
        },
      },
    }),
    prisma.gallery.findMany({
      where: { ownerId, trashedAt: null, eventId: null, status: "PUBLISHED" },
      orderBy: [{ eventDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { id: true, title: true, eventDate: true, ...usable },
    }),
    selected.length === 0
      ? []
      : prisma.gallery.findMany({
          where: { id: { in: selected }, ownerId, trashedAt: null, status: "PUBLISHED" },
          select: {
            id: true,
            title: true,
            photoOrder: true,
            chapters: { select: CHAPTER_START_SELECT },
            photos: { where: STUDIO_PHOTO_WHERE, select: STUDIO_PHOTO_SELECT },
          },
        }),
    instagramStatus(ownerId),
  ]);

  const groups: PickerGroup[] = [
    ...events
      .filter((event) => event.galleries.length > 0)
      .map((event) => ({
        id: event.id,
        title: event.title,
        date: event.eventDate?.toISOString() ?? null,
        galleries: event.galleries.map((g) => ({
          id: g.id,
          title: g.title,
          photos: g._count.photos,
        })),
      })),
    ...standalone.map((g) => ({
      id: g.id,
      title: g.title,
      date: g.eventDate?.toISOString() ?? null,
      galleries: [{ id: g.id, title: g.title, photos: g._count.photos }],
    })),
  ];

  // In the order the photographer ticked them: the reel follows it.
  const byId = new Map(chosen.map((g) => [g.id, g]));
  const galleries: ReelGallery[] = await Promise.all(
    selected.flatMap((id) => {
      const gallery = byId.get(id);
      if (!gallery) return [];
      return [
        toStudioPhotos(gallery.id, gallery.photoOrder, gallery.photos).then((photos) => ({
          id: gallery.id,
          title: gallery.title,
          chapterStarts: gallery.chapters.map((c) => chapterStartOf(gallery.photoOrder, c)),
          photos,
        })),
      ];
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reels s hudbou"
        crumbs={reelsCrumbs()}
        subtitle="Rychlé video na výšku z jedné nebo více svateb: co střih, to fotka, střihy na doby písničky. Několik variant vedle sebe."
      />
      <ReelSourcePicker groups={groups} selected={galleries.map((g) => g.id)} />
      {galleries.length > 0 && (
        <ReelStudio
          galleries={galleries}
          instagram={{ configured: metaConfigured(), account: instagramAccount, outcome }}
        />
      )}
    </div>
  );
}
