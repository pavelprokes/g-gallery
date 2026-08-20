import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { GalleryView } from "@/components/gallery-view";

// Dynamic by definition: token validity, expiry, and revocation are checked
// server-side on every request (docs/PLAN.md §4).
export const dynamic = "force-dynamic";

export default async function SharedGalleryPage(props: PageProps<"/g/[token]">) {
  const { token } = await props.params;

  const access = await resolveShareLink(token);
  if (!access.ok) {
    if (access.reason === "EXPIRED" || access.reason === "REVOKED") {
      return (
        <main className="flex min-h-dvh items-center justify-center p-8 text-center">
          <div>
            <h1 className="text-xl font-semibold">Odkaz už není platný</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Požádej fotografa o nový odkaz na galerii.
            </p>
          </div>
        </main>
      );
    }
    notFound();
  }

  const gallery = await prisma.gallery.findUnique({
    where: { id: access.shareLink.galleryId },
    select: {
      id: true,
      title: true,
      eventDate: true,
      photos: {
        where: { status: "CONFIRMED" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          objectKey: true,
          fileName: true,
          width: true,
          height: true,
        },
      },
    },
  });
  if (!gallery) notFound();

  return (
    <GalleryView
      token={token}
      title={gallery.title}
      eventDate={gallery.eventDate?.toLocaleDateString("cs-CZ") ?? null}
      photos={gallery.photos}
      allowDownload={access.shareLink.allowDownload}
    />
  );
}
