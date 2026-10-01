import type { Metadata } from "next";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import Image from "next/image";
import type { ReactNode } from "react";
import { SiteFooterIdentity } from "@/components/site-footer-identity";
import { Card } from "@/components/ui/card";
import {
  CheckCircleIcon,
  HeartIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
} from "@/components/ui/icons";
import type { Locale } from "@/i18n/locales";
import { previewMetadata } from "@/lib/og-image";
import cs from "../../../messages/cs.json";

/**
 * The client guide is written in Czech first and translated once the Czech is
 * settled, so until then it renders in Czech whatever the viewer's language —
 * en.json and fr.json hold a copy of the Czech `guide` only to keep the
 * catalogs' key sets equal (src/i18n/messages.test.ts). When they are
 * translated, drop this constant and the direct catalog import (use
 * `getTranslations` and the request locale like `/`), add the LocaleSwitcher
 * to the footer, index the page and list it in the sitemap.
 *
 * `createTranslator` over the imported catalog rather than
 * `getTranslations({ locale })`: src/i18n/request.ts always loads the
 * request's own locale, so the latter returns English strings to a viewer
 * whose cookie or browser says English, whatever locale is asked for.
 */
const GUIDE_LOCALE: Locale = "cs";

const MAIN_SITE_URL = "https://svatebni-fotograf-cechy.cz/";

export function generateMetadata(): Metadata {
  const t = createTranslator({ locale: GUIDE_LOCALE, messages: cs, namespace: "guide" });
  const title = t("pageTitle");
  const description = t("pageDescription");

  const preview = previewMetadata({
    title,
    description,
    locale: GUIDE_LOCALE,
    url: "/navod",
    imageKey: null,
  });

  return {
    title,
    description,
    alternates: { canonical: "/navod" },
    robots: { index: false, follow: true },
    ...preview,
  };
}

interface TipEntry {
  title: string;
  body: string;
}

/** A control's glyph shown inline in a sentence, so the reader knows what to look for. */
function InlineGlyph({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <span
      className="bg-brand-tint border-brand-border/70 text-brand-ink mx-0.5 inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full border px-1 align-middle dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children}
    </span>
  );
}

function StepList({ steps }: { steps: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="mt-4 space-y-4">
      {steps.map(({ title, body }, index) => (
        <li key={title} className="flex gap-3">
          <span className="bg-brand-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white tabular-nums">
            {index + 1}
          </span>
          <div className="text-sm">
            <p className="text-brand-ink font-medium dark:text-neutral-100">{title}</p>
            <div className="mt-1 space-y-1 text-neutral-600 dark:text-neutral-400">{body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function GuidePage() {
  const t = createTranslator({ locale: GUIDE_LOCALE, messages: cs, namespace: "guide" });
  const tGallery = createTranslator({ locale: GUIDE_LOCALE, messages: cs, namespace: "gallery" });
  const tMarketing = createTranslator({
    locale: GUIDE_LOCALE,
    messages: cs,
    namespace: "marketing",
  });
  const tFooter = createTranslator({
    locale: GUIDE_LOCALE,
    messages: cs,
    namespace: "siteFooter",
  });
  const tips = t.raw("print.tips") as TipEntry[];

  const glyphs = {
    printer: () => (
      <InlineGlyph label={tGallery("markForPrint")}>
        <PrinterIcon className="size-3.5" />
      </InlineGlyph>
    ),
    marking: () => (
      <InlineGlyph label={tGallery("markingModeLabel")}>
        <HeartIcon className="size-3.5" />
        <PrinterIcon className="size-3.5" />
      </InlineGlyph>
    ),
    plus: () => (
      <InlineGlyph label={tGallery("increasePrintQuantity")}>
        <PlusIcon className="size-3.5" />
      </InlineGlyph>
    ),
    minus: () => (
      <InlineGlyph label={tGallery("decreasePrintQuantity")}>
        <MinusIcon className="size-3.5" />
      </InlineGlyph>
    ),
  };

  const summaryTerms = (["photos", "pieces", "everyone", "saved"] as const).map((key) => ({
    term: t(`print.summary.${key}Term`),
    body: t(`print.summary.${key}Body`),
  }));

  return (
    <main lang={GUIDE_LOCALE} className="font-brand mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <header className="grid gap-8 sm:grid-cols-[1.4fr_1fr] sm:items-center">
        <div>
          <p className="text-brand-primary text-sm font-medium tracking-wide uppercase">
            {t("kicker")}
          </p>
          <h1 className="text-brand-ink mt-2 text-3xl font-semibold text-balance sm:text-4xl dark:text-neutral-100">
            {t("heroTitle")}
          </h1>
          <p className="mt-4 max-w-prose text-neutral-600 dark:text-neutral-400">{t("heroLead")}</p>
          <a
            href={MAIN_SITE_URL}
            className="text-brand-primary hover:text-brand-primary-dark mt-6 inline-block text-sm font-medium underline underline-offset-4"
          >
            {tMarketing("backToMainSite")}
          </a>
        </div>
        <Image
          src="/iphone-mockup.webp"
          alt={tMarketing("heroImageAlt")}
          width={1000}
          height={2073}
          sizes="(max-width: 640px) 12rem, 30vw"
          priority
          className="mx-auto h-auto w-full max-w-48 sm:max-w-56"
        />
      </header>

      <nav
        aria-labelledby="obsah"
        className="border-brand-border/60 mt-12 rounded-xl border p-4 sm:p-5 dark:border-neutral-800"
      >
        <h2 id="obsah" className="text-brand-primary text-sm font-medium tracking-wide uppercase">
          {t("tocHeading")}
        </h2>
        <ol className="mt-2 space-y-1 text-sm">
          <li>
            <a
              href="#tisk"
              className="text-brand-ink hover:text-brand-primary font-medium underline-offset-4 hover:underline dark:text-neutral-100"
            >
              {t("print.heading")}
            </a>
          </li>
        </ol>
      </nav>

      <section aria-labelledby="tisk" className="mt-12 mb-12 scroll-mt-6">
        <h2 id="tisk" className="text-brand-ink text-2xl font-semibold dark:text-neutral-100">
          {t("print.heading")}
        </h2>
        <p className="mt-2 max-w-prose text-neutral-600 dark:text-neutral-400">
          {t("print.intro")}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card className="bg-brand-tint dark:bg-neutral-900">
            <h3 className="text-brand-ink font-semibold dark:text-neutral-100">
              {t("print.grid.title")}
            </h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {t("print.grid.lead")}
            </p>
            <StepList
              steps={[
                {
                  title: t("print.grid.showTitle"),
                  body: (
                    <>
                      <p>{t.rich("print.grid.showPhone", glyphs)}</p>
                      <p>{t("print.grid.showDesktop")}</p>
                    </>
                  ),
                },
                {
                  title: t("print.grid.tapTitle"),
                  body: <p>{t.rich("print.grid.tapBody", glyphs)}</p>,
                },
              ]}
            />
          </Card>
          <Card className="bg-brand-tint dark:bg-neutral-900">
            <h3 className="text-brand-ink font-semibold dark:text-neutral-100">
              {t("print.detail.title")}
            </h3>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {t("print.detail.lead")}
            </p>
            <StepList
              steps={[
                { title: t("print.detail.openTitle"), body: <p>{t("print.detail.openBody")}</p> },
                {
                  title: t("print.detail.tapTitle"),
                  body: <p>{t.rich("print.detail.tapBody", glyphs)}</p>,
                },
                { title: t("print.detail.nextTitle"), body: <p>{t("print.detail.nextBody")}</p> },
              ]}
            />
          </Card>
        </div>

        <h3 className="text-brand-ink mt-10 text-xl font-semibold dark:text-neutral-100">
          {t("print.quantity.heading")}
        </h3>
        <p className="mt-2 max-w-prose text-sm text-neutral-600 dark:text-neutral-400">
          {t("print.quantity.lead")}
        </p>
        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.4fr] sm:items-start">
          {/* A tile cropped out of the hero mockup with the gallery's own stepper
              drawn over it — the real control's look, not a screenshot, so it
              never goes stale and translates with the page. */}
          <div
            role="img"
            aria-label={t("print.quantity.demoLabel")}
            className="relative mx-auto aspect-[447/627] w-full max-w-64 overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800"
          >
            <Image
              src="/iphone-mockup.webp"
              alt=""
              width={1000}
              height={2073}
              sizes="(max-width: 640px) 36rem, 36rem"
              className="absolute top-[-23.9%] left-[-11.2%] h-auto w-[223.7%] max-w-none"
            />
            <div
              aria-hidden
              className="absolute top-2 right-2 flex items-center rounded-full bg-black/55 text-white"
            >
              <span className="flex size-9 items-center justify-center">
                <MinusIcon className="size-4" />
              </span>
              <span className="min-w-[1.25em] text-center text-xs tabular-nums">3</span>
              <span className="text-xs text-white/70 tabular-nums">(+2)</span>
              <span className="flex size-9 items-center justify-center">
                <PlusIcon className="size-4" />
              </span>
            </div>
          </div>
          <ul className="space-y-3">
            {[
              t.rich("print.quantity.plus", glyphs),
              t.rich("print.quantity.minus", glyphs),
              t("print.quantity.max"),
              t("print.quantity.others"),
            ].map((item, index) => (
              <li key={index} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <CheckCircleIcon className="text-brand-primary mt-0.5 size-4 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <h3 className="text-brand-ink mt-10 text-xl font-semibold dark:text-neutral-100">
          {t("print.summary.heading")}
        </h3>
        <p className="mt-2 max-w-prose text-sm text-neutral-600 dark:text-neutral-400">
          {t("print.summary.lead")}
        </p>
        {/* The gallery's sticky print summary (src/components/gallery-view.tsx),
            built from the same messages, over a dark strip standing in for photos. */}
        <div
          role="img"
          aria-label={t("print.summary.demoLabel")}
          className="mt-4 flex justify-center rounded-xl bg-gradient-to-br from-neutral-700 to-neutral-900 px-3 py-6"
        >
          <p className="flex max-w-md flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-[22px] bg-black/55 px-4 py-2 text-sm text-white">
            <PrinterIcon className="h-4 w-4 shrink-0" />
            <span className="font-medium">
              {tGallery("printSummary", { photos: 24, pieces: 30 })}
            </span>
            <span className="text-white/70">{tGallery("printSyncSaved")}</span>
            <span className="basis-full text-center text-white/70">
              {tGallery("printSummaryEveryone", { photos: 31, pieces: 42 })}
            </span>
          </p>
        </div>
        <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {summaryTerms.map(({ term, body }) => (
            <div key={term} className="contents">
              <dt className="text-brand-ink font-medium dark:text-neutral-100">{term}</dt>
              <dd className="mb-2 text-neutral-600 sm:mb-0 dark:text-neutral-400">{body}</dd>
            </div>
          ))}
        </dl>

        <h3 className="text-brand-ink mt-10 text-xl font-semibold dark:text-neutral-100">
          {t("print.tipsHeading")}
        </h3>
        <ul className="mt-4 space-y-3">
          {tips.map(({ title, body }) => (
            <li key={title} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <CheckCircleIcon className="text-brand-primary mt-0.5 size-4 shrink-0" />
              <span>
                <strong className="text-brand-ink font-medium dark:text-neutral-100">
                  {title}
                </strong>{" "}
                {body}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Card className="bg-brand-tint mb-12 dark:bg-neutral-900">
        <p className="text-brand-ink text-sm dark:text-neutral-100">
          {t.rich("help", {
            a: (chunks) => (
              <a
                href={`mailto:${tFooter("email")}`}
                className="text-brand-primary hover:text-brand-primary-dark font-medium underline underline-offset-4"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </Card>

      <footer className="border-brand-border/60 border-t pt-8 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-500">
        {/* A Client Component reading its own provider — scoped to Czech here too. */}
        <NextIntlClientProvider locale={GUIDE_LOCALE} messages={{ siteFooter: cs.siteFooter }}>
          <SiteFooterIdentity className="text-xs" />
        </NextIntlClientProvider>
      </footer>
    </main>
  );
}
