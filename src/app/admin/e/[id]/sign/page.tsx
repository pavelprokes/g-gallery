import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { decryptToken } from "@/lib/token-cipher";
import { renderSignQrSvg } from "@/lib/qr";
import { absoluteSignUrl, eventSignPath } from "@/lib/sign-url";
import { isCardVisible } from "@/lib/event-cards";
import { PrintableSign } from "@/components/printable-sign";
import { Alert } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

/**
 * Printable QR sign for a wedding page (docs/GUEST-GALLERIES.md F7). Always
 * encodes the event's own `/s/` address, never a gallery's `/g/` link —
 * docs/GUEST-GALLERIES.md §2 is explicit that the printed sign has to survive
 * galleries coming and going under it, which only the event address does.
 */
export default async function EventSignPage(props: PageProps<"/admin/e/[id]/sign">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const { id } = await props.params;

  const event = await prisma.event.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      slug: true,
      tokenCipher: true,
      galleries: {
        select: {
          id: true,
          title: true,
          eventKey: true,
          position: true,
          listedOnEvent: true,
          status: true,
          trashedAt: true,
          eventLink: {
            select: { allowUpload: true, passwordHash: true, revokedAt: true, expiresAt: true },
          },
        },
      },
    },
  });
  if (!event) notFound();

  const backLink = (
    <Link href={`/admin/e/${event.id}`} className="no-print text-sm text-neutral-500 underline">
      ← Zpět na svatbu
    </Link>
  );
  const heading = (
    <h1 className="no-print text-brand-ink text-lg font-semibold">
      Cedulka k tisku — {event.title}
    </h1>
  );

  const token = decryptToken(event.tokenCipher);
  if (!token) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        {backLink}
        {heading}
        <Alert>
          Adresu téhle svatby už nelze zobrazit — vznikla dřív, než se odkazy ukládaly čitelně.
          Cedulku z ní nejde vytisknout.
        </Alert>
      </main>
    );
  }

  const url = absoluteSignUrl(eventSignPath(token, event.slug));
  const qrSvg = await renderSignQrSvg(url);

  const now = new Date();
  const uploadReady = event.galleries.find(
    (gallery) =>
      isCardVisible(gallery, now) &&
      gallery.eventLink?.allowUpload === true &&
      !gallery.eventLink.passwordHash,
  );

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      {backLink}
      {heading}
      <PrintableSign
        url={url}
        qrSvg={qrSvg}
        targetLabel={event.title}
        readinessNote={
          uploadReady
            ? { ok: true, text: `nahrávání zapnuto (${uploadReady.title})` }
            : {
                ok: false,
                text: "zatím žádná zveřejněná galerie s nahráváním — tenhle QR zatím nikoho nikam nepustí",
              }
        }
      />
    </main>
  );
}
