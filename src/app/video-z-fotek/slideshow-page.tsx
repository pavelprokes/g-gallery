import type { Metadata } from "next";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { SiteFooterIdentity } from "@/components/site-footer-identity";
import { SlideshowMaker } from "@/components/slideshow/slideshow-maker";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircleIcon } from "@/components/ui/icons";
import { guidePath } from "@/lib/guide-path";
import { slideshowJsonLd, type FaqEntry } from "@/lib/landing-jsonld";
import { previewMetadata } from "@/lib/og-image";
import { SITE_ORIGIN } from "@/lib/site-url";
import { SLIDESHOW_PATHS, type SlideshowLocale } from "@/lib/slideshow-path";
import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import pl from "../../../messages/pl.json";
import sk from "../../../messages/sk.json";
import slideshowCs from "./slideshow.cs.json";
import slideshowDe from "./slideshow.de.json";
import slideshowEn from "./slideshow.en.json";
import slideshowEs from "./slideshow.es.json";
import slideshowFr from "./slideshow.fr.json";
import slideshowPl from "./slideshow.pl.json";
import slideshowSk from "./slideshow.sk.json";

/**
 * The public slideshow maker's page (docs/SLIDESHOW-MAKER.md): the tool
 * itself right under the hero, then what it does, privacy, limits, the link
 * to the photographer and the questions people ask. Its copy lives next to the
 * page, as the guide's does (src/app/navod/guide-page.tsx), and the language
 * comes from the address alone.
 */
const MAIN_SITE_URL = "https://svatebni-fotograf-cechy.cz/";

const MESSAGES = {
  cs: { ...cs, slideshowMaker: slideshowCs },
  en: { ...en, slideshowMaker: slideshowEn },
  fr: { ...fr, slideshowMaker: slideshowFr },
  de: { ...de, slideshowMaker: slideshowDe },
  es: { ...es, slideshowMaker: slideshowEs },
  sk: { ...sk, slideshowMaker: slideshowSk },
  pl: { ...pl, slideshowMaker: slideshowPl },
} satisfies Record<SlideshowLocale, unknown>;

type SectionKey = "tool" | "how" | "features" | "privacy" | "limits" | "wedding" | "faq";

/** Section anchors: the Czech ones were published first and are kept; every other language uses the English set. */
const CZECH_ANCHORS: Record<SectionKey, string> = {
  tool: "vytvorit",
  how: "jak-to-funguje",
  features: "co-umi",
  privacy: "soukromi",
  limits: "fotky-a-zarizeni",
  wedding: "svatba",
  faq: "otazky",
};
const ENGLISH_ANCHORS: Record<SectionKey, string> = {
  tool: "create",
  how: "how-it-works",
  features: "features",
  privacy: "privacy",
  limits: "photos-and-devices",
  wedding: "wedding",
  faq: "questions",
};

/** The link to the maker on the home page, in the viewer's language. */
export function slideshowHomeLink(locale: SlideshowLocale): { href: string; label: string } {
  return { href: SLIDESHOW_PATHS[locale], label: MESSAGES[locale].slideshowMaker.page.homeLink };
}

function pageTranslator(locale: SlideshowLocale) {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "slideshowMaker.page",
  });
}

export function slideshowMetadata(locale: SlideshowLocale): Metadata {
  const t = pageTranslator(locale);
  const title = t("pageTitle");
  const description = t("pageDescription");
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: SLIDESHOW_PATHS[locale],
      languages: { ...SLIDESHOW_PATHS, "x-default": SLIDESHOW_PATHS.en },
    },
    robots: { index: true, follow: true },
    ...previewMetadata({
      title,
      description,
      locale,
      url: SLIDESHOW_PATHS[locale],
      imageKey: null,
    }),
  };
}

interface Step {
  title: string;
  body: string;
}

export function SlideshowPage({ locale }: { locale: SlideshowLocale }) {
  const messages = MESSAGES[locale];
  const anchor = locale === "cs" ? CZECH_ANCHORS : ENGLISH_ANCHORS;
  const t = pageTranslator(locale);
  const faq = t.raw("faq") as FaqEntry[];
  const jsonLd = slideshowJsonLd({
    locale,
    url: `${SITE_ORIGIN}${SLIDESHOW_PATHS[locale]}`,
    title: t("pageTitle"),
    description: t("pageDescription"),
    faq,
  });
  const heading = "text-brand-ink text-2xl font-semibold dark:text-neutral-100";
  const lead = "mt-2 max-w-prose text-neutral-600 dark:text-neutral-400";
  const link =
    "text-brand-primary hover:text-brand-primary-dark font-medium underline underline-offset-4";

  return (
    <main lang={locale} className="font-brand mx-auto max-w-4xl px-4 py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="max-w-3xl">
        <p className="text-brand-primary text-sm font-medium tracking-wide uppercase">
          {t("kicker")}
        </p>
        <h1 className="text-brand-ink mt-2 text-3xl font-semibold text-balance sm:text-4xl dark:text-neutral-100">
          {t("heroTitle")}
        </h1>
        <p className="mt-4 max-w-prose text-neutral-600 dark:text-neutral-400">{t("heroLead")}</p>
        <p className="text-brand-ink mt-4 flex items-start gap-2 text-sm font-medium dark:text-neutral-100">
          <CheckCircleIcon className="text-brand-primary mt-0.5 size-4 shrink-0" />
          {t("privacyBadge")}
        </p>
      </header>

      <section
        aria-labelledby={anchor.tool}
        className="border-brand-border/60 mt-8 rounded-2xl border p-4 sm:p-6 dark:border-neutral-800"
      >
        <h2 id={anchor.tool} className={`${heading} mb-4`}>
          {t("toolHeading")}
        </h2>
        <NextIntlClientProvider
          locale={locale}
          messages={{ slideshowMaker: { tool: messages.slideshowMaker.tool } }}
        >
          <SlideshowMaker fileStem={SLIDESHOW_PATHS[locale].slice(1)} />
        </NextIntlClientProvider>
      </section>

      <section aria-labelledby={anchor.how} className="mt-14">
        <h2 id={anchor.how} className={heading}>
          {t("howHeading")}
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {(t.raw("how") as Step[]).map((step, i) => (
            <li key={step.title}>
              <Card className="bg-brand-tint h-full dark:bg-neutral-900">
                <p className="text-brand-primary text-sm font-semibold">{i + 1}.</p>
                <h3 className="text-brand-ink mt-1 font-semibold dark:text-neutral-100">
                  {step.title}
                </h3>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby={anchor.features} className="mt-14">
        <h2 id={anchor.features} className={heading}>
          {t("featuresHeading")}
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {(t.raw("features") as string[]).map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2 text-neutral-700 dark:text-neutral-300"
            >
              <CheckCircleIcon className="text-brand-primary mt-1 size-4 shrink-0" />
              {feature}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={anchor.privacy} className="mt-14">
        <h2 id={anchor.privacy} className={heading}>
          {t("privacyHeading")}
        </h2>
        <p className={lead}>{t("privacyBody")}</p>
      </section>

      <section aria-labelledby={anchor.limits} className="mt-14">
        <h2 id={anchor.limits} className={heading}>
          {t("limitsHeading")}
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-neutral-700 dark:text-neutral-300">
          {(t.raw("limits") as string[]).map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={anchor.wedding} className="mt-14">
        <Card className="bg-brand-tint dark:bg-neutral-900">
          <h2 id={anchor.wedding} className={heading}>
            {t("weddingHeading")}
          </h2>
          <p className={lead}>{t("weddingBody")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <a href={MAIN_SITE_URL} className={buttonClasses("secondary", "lg")}>
              {t("weddingCta")} →
            </a>
            <a href={guidePath(locale)} className={`${link} text-sm`}>
              {t("galleryLink")}
            </a>
          </div>
        </Card>
      </section>

      <section aria-labelledby={anchor.faq} className="mt-14">
        <h2 id={anchor.faq} className={heading}>
          {t("faqHeading")}
        </h2>
        <div className="mt-4 divide-y divide-neutral-200 dark:divide-neutral-800">
          {faq.map(({ q, a }) => (
            <details key={q} className="group py-3">
              <summary className="text-brand-ink flex min-h-11 cursor-pointer items-center font-medium dark:text-neutral-100">
                {q}
              </summary>
              <p className="mt-1 max-w-prose text-neutral-600 dark:text-neutral-400">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="border-brand-border/60 mt-16 border-t pt-8 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-500">
        <NextIntlClientProvider locale={locale} messages={{ siteFooter: messages.siteFooter }}>
          <SiteFooterIdentity className="text-xs" current="slideshow" />
        </NextIntlClientProvider>
      </footer>
    </main>
  );
}
