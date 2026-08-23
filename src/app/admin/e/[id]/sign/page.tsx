import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { decryptToken } from "@/lib/token-cipher";
import { renderSignQrSvg } from "@/lib/qr";
import { absoluteSignUrl, eventSignPath } from "@/lib/sign-url";
import { isCardVisible } from "@/lib/event-cards";
import { PrintableSign } from "@/components/printable-sign";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { eventSignCrumbs } from "@/lib/admin-breadcrumbs";

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

  // Rendered above every branch below — the header is print:hidden, so it costs
  // the printed card nothing and the page never loses its way back.
  const header = <PageHeader title="Cedulka k tisku" crumbs={eventSignCrumbs(event)} />;

  const token = decryptToken(event.tokenCipher);
  if (!token) {
    return (
      <div className="max-w-2xl space-y-6">
        {header}
        <Alert>
          Adresu téhle svatby už nelze zobrazit — vznikla dřív, než se odkazy ukládaly čitelně.
          Cedulku z ní nejde vytisknout.
        </Alert>
      </div>
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
    <div className="max-w-2xl space-y-6">
      {header}
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
    </div>
  );
}
