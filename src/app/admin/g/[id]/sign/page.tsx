import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { decryptToken } from "@/lib/token-cipher";
import { renderSignQrSvg } from "@/lib/qr";
import { absoluteSignUrl, gallerySignPath } from "@/lib/sign-url";
import { PrintableSign } from "@/components/printable-sign";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { gallerySignCrumbs } from "@/lib/admin-breadcrumbs";

export const dynamic = "force-dynamic";

/**
 * Printable QR sign for one gallery's own share link (docs/GUEST-GALLERIES.md
 * F7). Only reachable for a link with `allowUpload` and no password — round-1
 * QA review: a sign for a read-only link, or one that would hand a guest a
 * password wall with no password printed on it, is a silent wedding-night
 * failure with no fallback, so it is refused here rather than generated.
 */
export default async function GallerySignPage(props: PageProps<"/admin/g/[id]/sign">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const { id } = await props.params;
  const { linkId } = await props.searchParams;

  const gallery = await prisma.gallery.findFirst({
    where: { id, ownerId: session.user.id },
    // `event` is only for the breadcrumb — an event-owned gallery routes through
    // its wedding rather than jumping straight back to the overview.
    select: { id: true, title: true, event: { select: { id: true, title: true } } },
  });
  if (!gallery) notFound();

  // Six of the seven exits from this page are refusals. Wrapping them all in one
  // helper is what keeps the way back — and the breadcrumb — on every one of them.
  const page = (children: ReactNode) => (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Cedulka k tisku" crumbs={gallerySignCrumbs(gallery)} />
      {children}
    </div>
  );

  const link =
    typeof linkId === "string"
      ? await prisma.shareLink.findFirst({
          where: { id: linkId, galleryId: gallery.id },
          select: {
            id: true,
            slug: true,
            tokenCipher: true,
            allowUpload: true,
            passwordHash: true,
            revokedAt: true,
          },
        })
      : null;

  if (!link) {
    return page(
      <Alert>Vyber odkaz z detailu galerie — tlačítko „Cedulka k tisku“ je u něj.</Alert>,
    );
  }
  if (link.revokedAt) {
    return page(
      <Alert>Tenhle odkaz je zrušený — cedulka by vedla nikam. Vytvoř nový odkaz.</Alert>,
    );
  }
  if (!link.allowUpload) {
    return page(
      <Alert>
        Tenhle odkaz nemá zapnuté nahrávání hosty — cedulka by hosta pustila do galerie, ale
        tlačítko nahrát by odmítlo každou fotku. Zapni „Hosté smí nahrávat“ u odkazu, nebo vyber
        jiný.
      </Alert>,
    );
  }
  if (link.passwordHash) {
    return page(
      <Alert>
        Tenhle odkaz je chráněný heslem — cedulka s QR kódem samotná hosta pustí jen k zadání hesla,
        které na ní není. Na cedulku pro hosty nikdy nedávej odkaz s heslem — vytvoř zvlášť odkaz
        bez hesla se zapnutým nahráváním.
      </Alert>,
    );
  }

  const token = decryptToken(link.tokenCipher);
  if (!token) {
    return page(
      <Alert>
        Adresu tohohle odkazu už nelze zobrazit — vznikl dřív, než se odkazy ukládaly čitelně.
        Vytvoř nový odkaz a cedulku z něj.
      </Alert>,
    );
  }

  const url = absoluteSignUrl(gallerySignPath(token, link.slug));
  const qrSvg = await renderSignQrSvg(url);

  return page(
    <PrintableSign
      url={url}
      qrSvg={qrSvg}
      targetLabel={gallery.title}
      readinessNote={{ ok: true, text: "nahrávání zapnuto" }}
    />,
  );
}
