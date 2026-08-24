import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { resolveEvent } from "@/lib/event-access";
import { resolveShareLink } from "@/lib/share-access";
import { compositeToken } from "@/lib/event-token";
import { loadGalleryViewData } from "@/lib/shared-gallery";
import { GalleryView } from "@/components/gallery-view";
import { SharePasswordForm } from "@/components/share-password-form";
import { EventPartGone } from "@/components/share-link-dead";
import { EventHub } from "@/components/event-hub";

// Same reasons as the gallery route: the token's validity, the listing
// switches and the password cookie are all checked per request.
export const dynamic = "force-dynamic";

/**
 * The wedding page (docs/GUEST-GALLERIES.md §2 and §4).
 *
 * URL shape — note this route parses one segment, unlike `/g/`:
 *
 *   /s/{token}/{slug}          the wedding page
 *   /s/{token}/{slug}/{key}    one gallery listed on it
 *
 * The first trailing segment stays cosmetic, exactly like `/g/`'s. The second
 * is the per-wedding gallery key. A request with no segments at all redirects
 * to the canonical form, so the key is always at index 1 and can never be
 * confused with the slug.
 *
 * Galleries are addressed through the event token rather than their own share
 * token because raw share tokens are never stored (invariant 5) — the server
 * physically cannot rebuild a `/g/{token}` URL for its own cards. Permissions
 * still come from the ShareLink the owner designated, so this grants nothing
 * the gallery's own link would not.
 */
export async function generateMetadata(
  props: PageProps<"/s/[token]/[[...slug]]">,
): Promise<Metadata> {
  const { token } = await props.params;
  const event = await resolveEvent(token);
  const t = await getTranslations("gallery");

  // Never leak a title for a token that does not resolve, and never let this
  // page into an index — same unconditional rule as every share surface.
  return {
    title: event?.title ?? t("untitledPlaceholder"),
    robots: { index: false, follow: false },
  };
}

export default async function WeddingPage(props: PageProps<"/s/[token]/[[...slug]]">) {
  const { token, slug } = await props.params;

  const event = await resolveEvent(token);
  if (!event) notFound();

  const segments = slug ?? [];
  if (segments.length === 0) redirect(`/s/${encodeURIComponent(token)}/${event.slug}`);

  const requestedKey = segments[1];

  // One listed gallery renders in place rather than redirecting to it: on the
  // night, eighty people save whatever is in the address bar, and a redirect
  // would hand them a URL that can never grow a second card.
  const inlineCard = !requestedKey && event.cards.length === 1 ? event.cards[0] : undefined;
  const card = inlineCard ?? event.cards.find((c) => c.eventKey === requestedKey);

  if (requestedKey && !card) {
    // Reached from a stale card or a bookmark after the gallery was un-listed.
    // Deliberately does NOT *redirect* — the visitor stays where they landed —
    // but the way back is offered, which is safe precisely here: this URL
    // already carries the wedding's token, so the link hands over nothing they
    // were not already holding. A `/g/` link never carries it.
    return (
      <EventPartGone
        backHref={`/s/${encodeURIComponent(token)}/${event.slug}`}
        eventTitle={event.title}
      />
    );
  }

  if (!card) return <EventHub event={event} eventToken={token} />;

  const galleryToken = compositeToken(token, card.eventKey!);
  const access = await resolveShareLink(galleryToken);
  if (!access.ok) {
    if (access.reason === "PASSWORD_REQUIRED") return <SharePasswordForm token={galleryToken} />;
    return (
      <EventPartGone
        backHref={`/s/${encodeURIComponent(token)}/${event.slug}`}
        eventTitle={event.title}
      />
    );
  }

  const locale = await getLocale();
  const data = await loadGalleryViewData(access.shareLink, locale);
  if (!data) notFound();

  return (
    <GalleryView
      token={galleryToken}
      galleryId={access.shareLink.galleryId}
      title={data.title}
      eventDate={data.eventDate}
      photoCount={data.photoCount}
      archiveZipUrl={data.archiveZipUrl}
      initialPhotos={data.initialPhotos}
      initialCursor={data.initialCursor}
      imageGrant={data.imageGrant}
      viewers={data.viewers}
      allowDownload={access.shareLink.allowDownload}
      allowReactions={access.shareLink.allowReactions}
      allowUpload={access.shareLink.allowUpload}
      backHref={
        event.cards.length > 1 ? `/s/${encodeURIComponent(token)}/${event.slug}` : undefined
      }
      backLabel={event.title}
    />
  );
}
