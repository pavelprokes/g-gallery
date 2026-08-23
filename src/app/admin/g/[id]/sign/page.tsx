import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { decryptToken } from "@/lib/token-cipher";
import { renderSignQrSvg } from "@/lib/qr";
import { absoluteSignUrl, gallerySignPath } from "@/lib/sign-url";
import { PrintableSign } from "@/components/printable-sign";
import { Alert } from "@/components/ui/alert";

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
    select: { id: true, title: true },
  });
  if (!gallery) notFound();

  const backHref = `/admin/g/${gallery.id}`;
  const backLink = (
    <Link href={backHref} className="no-print text-sm text-neutral-500 underline">
      ← Zpět na galerii
    </Link>
  );
  const heading = (
    <h1 className="no-print text-brand-ink text-lg font-semibold">
      Cedulka k tisku — {gallery.title}
    </h1>
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
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        {backLink}
        {heading}
        <Alert>Vyber odkaz z detailu galerie — tlačítko „Cedulka k tisku“ je u něj.</Alert>
      </main>
    );
  }
  if (link.revokedAt) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        {backLink}
        {heading}
        <Alert>Tenhle odkaz je zrušený — cedulka by vedla nikam. Vytvoř nový odkaz.</Alert>
      </main>
    );
  }
  if (!link.allowUpload) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        {backLink}
        {heading}
        <Alert>
          Tenhle odkaz nemá zapnuté nahrávání hosty — cedulka by hosta pustila do galerie, ale
          tlačítko nahrát by odmítlo každou fotku. Zapni „Hosté smí nahrávat“ u odkazu, nebo vyber
          jiný.
        </Alert>
      </main>
    );
  }
  if (link.passwordHash) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        {backLink}
        {heading}
        <Alert>
          Tenhle odkaz je chráněný heslem — cedulka s QR kódem samotná hosta pustí jen k zadání
          hesla, které na ní není. Na cedulku pro hosty nikdy nedávej odkaz s heslem — vytvoř zvlášť
          odkaz bez hesla se zapnutým nahráváním.
        </Alert>
      </main>
    );
  }

  const token = decryptToken(link.tokenCipher);
  if (!token) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        {backLink}
        {heading}
        <Alert>
          Adresu tohohle odkazu už nelze zobrazit — vznikl dřív, než se odkazy ukládaly čitelně.
          Vytvoř nový odkaz a cedulku z něj.
        </Alert>
      </main>
    );
  }

  const url = absoluteSignUrl(gallerySignPath(token, link.slug));
  const qrSvg = await renderSignQrSvg(url);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      {backLink}
      {heading}
      <PrintableSign
        url={url}
        qrSvg={qrSvg}
        targetLabel={gallery.title}
        readinessNote={{ ok: true, text: "nahrávání zapnuto" }}
      />
    </main>
  );
}
