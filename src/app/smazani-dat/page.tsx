import type { Metadata } from "next";
import { MAIN_SITE_URL } from "@/lib/site-url";
import { Card } from "@/components/ui/card";

// The data-deletion instructions Meta asks every app for before it goes Live
// (docs/INSTAGRAM-AUDIO.md). The Instagram connection serves
// the photographer's own account only; this says what it keeps and how to
// remove it, in Czech and in English. Static — Meta's crawler must reach it.

export const metadata: Metadata = {
  title: "Smazání dat · Data deletion",
  description:
    "Jaká data ukládá propojení galerií s Instagramem a jak je smazat. What the Instagram connection stores and how to delete it.",
  alternates: { canonical: "/smazani-dat" },
};

export default function DataDeletionPage() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 leading-relaxed">
      <Card as="section" lang="cs">
        <h1 className="mb-3 text-xl font-semibold">Smazání dat z propojení s Instagramem</h1>
        <p className="mb-3">
          Administrace galerií fotografa Pavla Prokeše umí vyhledávat hudbu v knihovně Instagramu
          pro jeho vlastní krátká videa. Pro to si po přihlášení přes Facebook ukládá:
        </p>
        <ul className="mb-3 list-disc space-y-1 pl-5">
          <li>
            identifikátor a uživatelské jméno instagramového účtu a název propojené facebookové
            stránky,
          </li>
          <li>přístupové tokeny od Mety — pouze zašifrované.</li>
        </ul>
        <p className="mb-3">
          Neukládá žádná data jiných lidí: návštěvníků, hostů ani sledujících. Propojení slouží jen
          účtu fotografa.
        </p>
        <h2 className="mb-2 font-semibold">Jak data smazat</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            V administraci galerií na stránce Reels zvolte „Odpojit Instagram“ — záznam i tokeny se
            okamžitě smažou.
          </li>
          <li>
            Nebo na Facebooku: Nastavení a soukromí → Nastavení → Aplikace a weby → aplikaci
            odeberte. Tokeny tím přestanou platit.
          </li>
          <li>
            Nebo napište na{" "}
            {email ? (
              <a className="underline" href={`mailto:${email}`}>
                {email}
              </a>
            ) : (
              <a className="underline" href={MAIN_SITE_URL}>
                {MAIN_SITE_URL}
              </a>
            )}{" "}
            a data smažeme do 30 dnů.
          </li>
        </ol>
      </Card>

      <Card as="section" lang="en">
        <h2 className="mb-3 text-lg font-semibold">Deleting data from the Instagram connection</h2>
        <p className="mb-3">
          The gallery admin of photographer Pavel Prokeš can search Instagram&apos;s music library
          for his own short videos. After signing in with Facebook it stores the Instagram
          account&apos;s id and username, the linked Facebook Page&apos;s name, and Meta&apos;s
          access tokens — encrypted only. It stores no data about anyone else.
        </p>
        <p>
          To delete it: choose &ldquo;Odpojit Instagram&rdquo; (Disconnect Instagram) on the Reels
          page of the admin, which deletes the record and tokens at once; or remove the app in
          Facebook&apos;s Settings → Apps and Websites; or write to{" "}
          {email ? (
            <a className="underline" href={`mailto:${email}`}>
              {email}
            </a>
          ) : (
            <a className="underline" href={MAIN_SITE_URL}>
              {MAIN_SITE_URL}
            </a>
          )}{" "}
          and it is deleted within 30 days.
        </p>
      </Card>
    </main>
  );
}
