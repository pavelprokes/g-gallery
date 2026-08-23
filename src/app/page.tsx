import type { Metadata } from "next";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { CheckCircleIcon, DownloadIcon } from "@/components/ui/icons";

/** Matches the stroke style of src/components/ui/icons.tsx; not added there since it is used only here. */
function ProjectorIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

const PAGE_TITLE = "Svatební fotogalerie s QR kódem pro hosty";
const PAGE_DESCRIPTION =
  "Jedna galerie na svatební fotky — od fotografa jako hotové focení, nebo jako sdílená galerie, kam fotky nahrávají i hosté přes QR kód. Bez appky, bez registrace.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "/",
    siteName: "g-gallery",
    locale: "cs_CZ",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
};

const MAIN_SITE_URL = "https://svatebni-fotograf-cechy.cz/";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Kde vezmu QR kód nebo odkaz na galerii?",
    a: "Buď od fotografa, nebo přímo od snoubenců/novomanželů — obě strany mohou odkaz i QR kód dál sdílet, třeba přeposlaný v rodinném chatu nebo na kartičce položené na stole u fotokoutku. Pokud odkaz nemáte, stačí napsat jednomu z nich.",
  },
  {
    q: "Nevím heslo, co teď?",
    a: "Heslo zná jedině fotograf — je to jediný, kdo ho nastavil, a nikdo jiný ho nemůže obnovit ani obejít. Napište mu, ať vám ho pošle znovu. Nezkoušejte ho hádat: po pěti špatných pokusech se odkaz na chvíli zamkne úplně pro všechny, kdo ho mají.",
  },
  {
    q: "Odkaz nefunguje, nebo píše, že vypršel.",
    a: "Galerie po čase přestává přijímat návštěvy nebo nahrávání fotek. Fotograf ji může kdykoliv znovu otevřít nebo prodloužit — stačí se mu ozvat.",
  },
  {
    q: "Funguje to i bez signálu?",
    a: "Jakmile galerii jednou otevřete a zapnete offline režim (ikona stažení nahoře v liště), prohlížíte fotky i bez připojení — hodí se třeba na chatě v horách.",
  },
  {
    q: "Jak stáhnu všechny fotky najednou?",
    a: "Tlačítkem „Stáhnout vše“ se galerie zabalí do ZIPu. U velkých galerií to chvíli trvá, sestavuje se na pozadí — stačí se za chvíli vrátit.",
  },
];

const GUEST_TIPS: string[] = [
  "Nic se neinstaluje. Odkaz nebo QR kód od fotografa či snoubenců, tlačítko „Přidat fotky“ a systémový výběr souborů nebo rovnou foťák.",
  "Telefon klidně zamkněte uprostřed nahrávání — doběhne to na pozadí, jakmile se vrátíte.",
  "Napište své jméno, když se galerie zeptá — pár pak u fotky uvidí, od koho je.",
  "Fotku nahranou omylem si sami smažete přímo v galerii, nikam kvůli tomu psát nemusíte.",
  "Fotky z iPhonu fungují bez potíží — do prohlížeče se samy pošlou v běžném formátu. Jen když máte v Nastavení → Fotky → Přenos do Mac nebo PC zapnuté „Zachovat originály“ (netýká se většiny lidí), může nahrávka výjimečně selhat — přepněte tam na „Automaticky“ a zkuste to znovu.",
];

const FEATURES: string[] = [
  "Jeden odkaz, nic se neinstaluje — otevřete v běžném prohlížeči na mobilu i počítači.",
  "Rychlá mřížka fotek a prohlížení na celou obrazovku, plynulé i na starším telefonu.",
  "Stažení celé galerie jedním tlačítkem (ZIP).",
  "Oblíbené a reakce — označte si fotky, které se vám nejvíc líbí.",
  "Heslo a časové omezení — fotograf určuje, kdo a jak dlouho se do galerie dostane.",
  "Offline režim — jednou stažené fotky uvidíte i bez signálu.",
  "Upozornění na nové fotky, když je fotograf přidá.",
  "Fotky od hostů — hosté přidávají vlastní snímky ze svatby přímo do galerie, bez appky a bez účtu.",
  "Živá projekce — nové fotky od hostů naskakují na plátně v reálném čase.",
  "Víc galerií pod jedním odkazem, který postupně roste — výběr, kompletní set i galerie od hostů, aniž byste dostávali nový odkaz.",
];

const HIGHLIGHTS: { title: string; body: string; icon: typeof DownloadIcon }[] = [
  {
    title: "Stažení všech fotek najednou",
    body: "Jedno tlačítko, jeden ZIP se všemi fotkami ve vysokém rozlišení — žádné klikání fotku po fotce.",
    icon: DownloadIcon,
  },
  {
    title: "Živá projekce na svatbě",
    body: "Fotky od hostů naskakují na plátně v reálném čase, hned jak je někdo nahraje — ideální na promítání během večera.",
    icon: ProjectorIcon,
  },
];

export default function Home() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <main className="font-brand mx-auto max-w-3xl px-4 py-12 sm:py-16">
      {/* Static FAQPage structured data — content is the FAQ array above, never user input. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <header className="grid gap-8 sm:grid-cols-[1.2fr_1fr] sm:items-center">
        <div>
          <p className="text-brand-primary text-sm font-medium tracking-wide uppercase">
            Fotogalerie ke svatbě
          </p>
          <h1 className="text-brand-ink mt-2 text-3xl font-semibold text-balance sm:text-4xl dark:text-neutral-100">
            Svatební fotky na jednom odkazu — od fotografa i od hostů
          </h1>
          <p className="mt-4 max-w-prose text-neutral-600 dark:text-neutral-400">
            Tuhle galerii vám poslal fotograf, nebo vám ji přeposlali snoubenci/novomanželé — obě
            strany mohou odkaz i QR kód sdílet dál. Tady je návod, jak se do ní dostat, co s ní jde
            dělat, a co dělat, když si nevíte rady.
          </p>
          <a
            href={MAIN_SITE_URL}
            className="text-brand-primary hover:text-brand-primary-dark mt-6 inline-block text-sm font-medium underline underline-offset-4"
          >
            ← Zpět na svatebni-fotograf-cechy.cz
          </a>
        </div>
        <Image
          src="/iphone-mockup.webp"
          alt="Mřížka svatebních fotek v galerii na iPhonu"
          width={1000}
          height={2073}
          sizes="(max-width: 640px) 14rem, 40vw"
          priority
          className="mx-auto h-auto w-full max-w-56 sm:max-w-none"
        />
      </header>

      <section aria-labelledby="dva-zpusoby" className="mt-14 mb-12">
        <h2 id="dva-zpusoby" className="text-brand-ink text-xl font-semibold dark:text-neutral-100">
          Dva způsoby, jak galerii dostanete
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card className="bg-brand-tint dark:bg-neutral-900">
            <p className="text-brand-ink font-medium dark:text-neutral-100">Galerie od fotografa</p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Po focení vám fotograf pošle odkaz na hotové fotky ve vysokém rozlišení. Galerie
              zůstává dostupná dlouho po svatbě, stáhnete si ji jedním tlačítkem a nepotřebujete k
              tomu žádný účet.
            </p>
          </Card>
          <Card className="bg-brand-tint dark:bg-neutral-900">
            <p className="text-brand-ink font-medium dark:text-neutral-100">
              Bonus k focení: galerie od hostů
            </p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Součást balíčku ke svatebnímu focení. Hosté na místě naskenují QR kód na stole a
              nahrají svoje fotky ze svatby přímo do sdílené galerie — bez appky, bez registrace.
            </p>
          </Card>
        </div>
      </section>

      <section aria-labelledby="jak-to-funguje" className="mb-12">
        <h2
          id="jak-to-funguje"
          className="text-brand-ink text-xl font-semibold dark:text-neutral-100"
        >
          Jak to funguje
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            [
              "1. Dostanete odkaz",
              "Od fotografa, nebo od snoubenců — e-mailem, SMS, nebo na kartičce s QR kódem. Někdy k němu patří i heslo.",
            ],
            [
              "2. Otevřete v prohlížeči",
              "Nic se neinstaluje a není potřeba žádný účet — funguje to na mobilu i na počítači.",
            ],
            [
              "3. Prohlížíte, stahujete, přidáváte",
              "Podle toho, co vám fotograf u dané galerie povolil — viz seznam funkcí níže.",
            ],
          ].map(([title, body]) => (
            <Card key={title} className="bg-brand-tint dark:bg-neutral-900">
              <p className="text-brand-ink font-medium dark:text-neutral-100">{title}</p>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="highlighty" className="mb-12">
        <h2 id="highlighty" className="text-brand-ink text-xl font-semibold dark:text-neutral-100">
          Dvě věci, které se hodí nejvíc
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {HIGHLIGHTS.map(({ title, body, icon: Icon }) => (
            <Card
              key={title}
              className="border-brand-primary/30 flex gap-3 bg-white dark:bg-neutral-900"
            >
              <Icon className="text-brand-primary mt-0.5 size-5 shrink-0" />
              <div>
                <p className="text-brand-ink font-medium dark:text-neutral-100">{title}</p>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{body}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="napoveda" className="mb-12">
        <h2 id="napoveda" className="text-brand-ink text-xl font-semibold dark:text-neutral-100">
          Rychlá nápověda
        </h2>
        <div className="divide-brand-border/60 border-brand-border/60 mt-4 divide-y rounded-lg border dark:divide-neutral-800 dark:border-neutral-800">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group p-4">
              <summary className="text-brand-ink font-medium marker:content-none dark:text-neutral-100">
                <span className="mr-2 inline-block transition-transform group-open:rotate-90">
                  ›
                </span>
                {q}
              </summary>
              <p className="mt-2 pl-5 text-sm text-neutral-600 dark:text-neutral-400">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="tipy-pro-hosty" className="mb-12">
        <h2
          id="tipy-pro-hosty"
          className="text-brand-ink text-xl font-semibold dark:text-neutral-100"
        >
          Tipy a triky pro focení jako host
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Pokud fotograf nebo snoubenci povolili u galerie nahrávání, může kdokoli ze svatby přidat
          vlastní fotky přímo tam, kde skončí i ty od fotografa.
        </p>
        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.3fr] sm:items-start">
          <Image
            src="/qr-sign-table.webp"
            alt="Cedulka s QR kódem na svatební tabuli, mezi svícny a talíři"
            width={900}
            height={600}
            sizes="(max-width: 640px) 100vw, 40vw"
            className="aspect-[3/2] rounded-xl object-cover"
          />
          <ul className="space-y-3">
            {GUEST_TIPS.map((tip) => (
              <li key={tip} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <CheckCircleIcon className="text-brand-primary mt-0.5 size-4 shrink-0" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="co-umi" className="mb-12">
        <h2 id="co-umi" className="text-brand-ink text-xl font-semibold dark:text-neutral-100">
          Co všechno galerie umí
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Řazeno od toho, co využijete nejčastěji, po specialitky pro konkrétní chvíle svatby.
        </p>
        <ol className="mt-4 space-y-3">
          {FEATURES.map((feature, index) => (
            <li key={feature} className="flex gap-3 text-sm text-neutral-700 dark:text-neutral-300">
              <span className="text-brand-primary w-5 shrink-0 text-right font-medium tabular-nums">
                {index + 1}.
              </span>
              <span>{feature}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-brand-border/60 border-t pt-8 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-500">
        Tuhle galerii provozuje váš fotograf.{" "}
        <a
          href={MAIN_SITE_URL}
          className="text-brand-primary hover:text-brand-primary-dark font-medium underline underline-offset-4"
        >
          Svatební fotograf Čechy →
        </a>
      </footer>
    </main>
  );
}
