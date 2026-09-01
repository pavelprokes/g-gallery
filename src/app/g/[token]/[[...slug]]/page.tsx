import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { GalleryView } from "@/components/gallery-view";
import { SharePasswordForm } from "@/components/share-password-form";
import { ShareLinkDead } from "@/components/share-link-dead";
import { loadGalleryViewData } from "@/lib/shared-gallery";

// Dynamic by definition: token validity, expiry, revocation, and the password
// unlock cookie are checked server-side on every request (docs/PLAN.md §4).
export const dynamic = "force-dynamic";

// The trailing [[...slug]] is cosmetic only (docs/TODO.md §6) — never parsed,
// never part of resolution. `/g/{token}` and `/g/{token}/{anything}` resolve
// identically; the slug just makes a copy-pasted or bookmarked URL readable.

// Share links are unguessable but not access-controlled against crawlers, so
// every gallery page must stay out of search indexes unconditionally. The
// title is looked up separately from the page component (Next doesn't share
// results between generateMetadata and the page render) and must never leak
// a gallery's title for a token that fails to resolve (revoked, expired,
// password-gated, or unknown) — fall back to a neutral placeholder instead.
export async function generateMetadata(
  props: PageProps<"/g/[token]/[[...slug]]">,
): Promise<Metadata> {
  const { token } = await props.params;
  const t = await getTranslations("gallery");

  const access = await resolveShareLink(token);

  if (!access.ok) {
    return { title: t("untitledPlaceholder"), robots: { index: false, follow: false } };
  }

  const gallery = await prisma.gallery.findUnique({
    where: { id: access.shareLink.galleryId },
    select: { title: true },
  });

  return {
    title: gallery?.title ?? t("untitledPlaceholder"),
    robots: { index: false, follow: false },
  };
}

export default async function SharedGalleryPage(props: PageProps<"/g/[token]/[[...slug]]">) {
  const { token } = await props.params;

  const access = await resolveShareLink(token);

  if (!access.ok) {
    if (access.reason === "PASSWORD_REQUIRED") return <SharePasswordForm token={token} />;
    if (access.reason === "EXPIRED" || access.reason === "REVOKED") return <ShareLinkDead />;
    notFound();
  }

  const locale = await getLocale();
  const data = await loadGalleryViewData(access.shareLink, locale);
  if (!data) notFound();

  return (
    <GalleryView
      token={token}
      galleryId={access.shareLink.galleryId}
      title={data.title}
      eventDate={data.eventDate}
      photoCount={data.photoCount}
      archive={data.archive}
      initialPhotos={data.initialPhotos}
      initialCursor={data.initialCursor}
      imageGrant={data.imageGrant}
      viewers={data.viewers}
      promos={data.promos}
      allowDownload={access.shareLink.allowDownload}
      allowReactions={access.shareLink.allowReactions}
      allowUpload={access.shareLink.allowUpload}
      allowPrintSelection={access.shareLink.allowPrintSelection}
    />
  );
}
