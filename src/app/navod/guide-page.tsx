import type { Metadata } from "next";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import Image from "next/image";
import type { ComponentType } from "react";
import { SiteFooterIdentity } from "@/components/site-footer-identity";
import { Card } from "@/components/ui/card";
import {
  CameraIcon,
  CheckIcon,
  DownloadIcon,
  HeartIcon,
  MinusIcon,
  OfflineIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  PrinterIcon,
  ProjectorIcon,
  ShareIcon,
} from "@/components/ui/icons";
import { previewMetadata } from "@/lib/og-image";
import { GUIDE_LANGUAGE_NAMES, GUIDE_PATHS, type GuideLocale } from "@/lib/guide-path";
import { LOCALES } from "@/i18n/locales";
import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import pl from "../../../messages/pl.json";
import sk from "../../../messages/sk.json";
import guideCs from "./guide.cs.json";
import guideDe from "./guide.de.json";
import guideEn from "./guide.en.json";
import guideEs from "./guide.es.json";
import guideFr from "./guide.fr.json";
import guidePl from "./guide.pl.json";
import guideSk from "./guide.sk.json";
import {
  CheckList,
  GuideSection,
  InlineGlyph,
  Note,
  StepCard,
  StepList,
  SubHeading,
  TermList,
} from "./guide-ui";

/**
 * The client guide, in every language the app speaks: Czech at /navod,
 * English at /guide, the rest at /guide/<code> (`GUIDE_PATHS`). One page per
 * language, so each has its own address a search engine can index and link
 * the others by hreflang. The language comes from the address, never from the
 * viewer's cookie or browser: a link sent in an email must show the same page
 * to everyone who opens it.
 *
 * Its copy lives next to the page (guide.<code>.json), not in messages/*.json:
 * the root layout hands the whole shared catalog to the client on every page,
 * and this page's text is several times longer than anything a guest gallery
 * needs. The gallery's own strings it quotes (the print summary, button
 * names) still come from messages/<code>.json, so they cannot drift apart.
 *
 * `createTranslator` rather than `getTranslations({ locale })`:
 * src/i18n/request.ts always loads the request's own locale, so the latter
 * returns the viewer's language whatever locale is asked for.
 */
const MAIN_SITE_URL = "https://svatebni-fotograf-cechy.cz/";

const SECTION_KEYS = [
  "start",
  "browse",
  "print",
  "favorites",
  "download",
  "corrections",
  "guests",
  "offline",
  "privacy",
  "trouble",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

type Anchors = Record<SectionKey | "devices", string>;

/** Section anchors. The Czech ones are older than the other languages and are kept. */
const CZECH_ANCHORS: Anchors = {
  start: "zaciname",
  browse: "prohlizeni",
  print: "tisk",
  favorites: "oblibene",
  download: "stahovani",
  corrections: "pripominky",
  guests: "hoste",
  offline: "offline",
  privacy: "soukromi",
  trouble: "problemy",
  devices: "jine-zarizeni",
};

/** Every other language links by the English anchors — one plain-ASCII set to keep stable. */
const ENGLISH_ANCHORS: Anchors = {
  start: "getting-started",
  browse: "browsing",
  print: "print",
  favorites: "favourites",
  download: "downloading",
  corrections: "edits",
  guests: "guests",
  offline: "offline",
  privacy: "privacy",
  trouble: "troubleshooting",
  devices: "other-device",
};

const TOC_ICONS: Partial<Record<SectionKey, ComponentType<{ className?: string }>>> = {
  start: CheckIcon,
  browse: PlayIcon,
  print: PrinterIcon,
  favorites: HeartIcon,
  download: DownloadIcon,
  corrections: PencilIcon,
  guests: CameraIcon,
  offline: OfflineIcon,
};

const MESSAGES = {
  cs: { ...cs, guide: guideCs },
  en: { ...en, guide: guideEn },
  fr: { ...fr, guide: guideFr },
  de: { ...de, guide: guideDe },
  es: { ...es, guide: guideEs },
  sk: { ...sk, guide: guideSk },
  pl: { ...pl, guide: guidePl },
} satisfies Record<GuideLocale, unknown>;

export function guideMetadata(locale: GuideLocale): Metadata {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "guide" });
  const title = t("pageTitle");
  const description = t("pageDescription");

  const preview = previewMetadata({
    title,
    description,
    locale,
    url: GUIDE_PATHS[locale],
    imageKey: null,
  });

  return {
    title,
    description,
    alternates: {
      canonical: GUIDE_PATHS[locale],
      languages: { ...GUIDE_PATHS, "x-default": GUIDE_PATHS.en },
    },
    robots: { index: true, follow: true },
    ...preview,
  };
}

interface TitledEntry {
  title: string;
  body: string;
}

interface TermEntry {
  term: string;
  body: string;
}

export function GuidePage({ locale }: { locale: GuideLocale }) {
  const messages = MESSAGES[locale];
  const anchor = locale === "cs" ? CZECH_ANCHORS : ENGLISH_ANCHORS;
  const t = createTranslator({ locale, messages, namespace: "guide" });
  const tGallery = createTranslator({
    locale,
    messages,
    namespace: "gallery",
  });
  const tCorrections = createTranslator({
    locale,
    messages,
    namespace: "corrections",
  });
  const tMarketing = createTranslator({
    locale,
    messages,
    namespace: "marketing",
  });
  const tFooter = createTranslator({
    locale,
    messages,
    namespace: "siteFooter",
  });

  // The gallery's own controls, shown inline in the sentences that name them.
  // Labelled with the gallery's own accessible names, so a screen reader hears
  // the same words here as on the button itself.
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
    heart: () => (
      <InlineGlyph label={tGallery("addToFavorites")}>
        <HeartIcon className="size-3.5" />
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
    download: () => (
      <InlineGlyph label={tGallery("downloadOriginal")}>
        <DownloadIcon className="size-3.5" />
      </InlineGlyph>
    ),
    check: () => (
      <InlineGlyph label={tGallery("select")}>
        <CheckIcon className="size-3.5" />
      </InlineGlyph>
    ),
    pencil: () => (
      <InlineGlyph label={tCorrections("toolbar")}>
        <PencilIcon className="size-3.5" />
      </InlineGlyph>
    ),
    projector: () => (
      <InlineGlyph>
        <ProjectorIcon className="size-3.5" />
      </InlineGlyph>
    ),
    share: () => (
      <InlineGlyph label={tGallery("sharePhoto")}>
        <ShareIcon className="size-3.5" />
      </InlineGlyph>
    ),
  };

  const linkClasses =
    "text-brand-primary hover:text-brand-primary-dark font-medium underline underline-offset-4";

  return (
    <main lang={locale} className="font-brand mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <header className="grid gap-8 sm:grid-cols-[1.4fr_1fr] sm:items-center">
        <div>
          <p className="text-brand-primary text-sm font-medium tracking-wide uppercase">
            {t("kicker")}
          </p>
          <h1 className="text-brand-ink mt-2 text-3xl font-semibold text-balance sm:text-4xl dark:text-neutral-100">
            {t("heroTitle")}
          </h1>
          <p className="mt-4 max-w-prose text-neutral-600 dark:text-neutral-400">{t("heroLead")}</p>
          <a href={MAIN_SITE_URL} className={`${linkClasses} mt-6 inline-block text-sm`}>
            {tMarketing("backToMainSite")}
          </a>
          <nav aria-label={t("otherLanguages")} className="mt-4 text-sm">
            <p className="text-neutral-600 dark:text-neutral-400">{t("otherLanguages")}</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {LOCALES.filter((other) => other !== locale).map((other) => (
                <li key={other}>
                  <a
                    href={GUIDE_PATHS[other]}
                    hrefLang={other}
                    lang={other}
                    className={`${linkClasses} inline-block py-1`}
                  >
                    {GUIDE_LANGUAGE_NAMES[other]}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <Image
          src="/iphone-mockup.webp"
          alt={tMarketing("heroImageAlt")}
          width={1000}
          height={2073}
          sizes="30vw"
          className="mx-auto h-auto w-full max-w-56 max-sm:hidden"
        />
      </header>

      <nav
        aria-labelledby="rozcestnik"
        className="border-brand-border/60 mt-12 rounded-xl border p-4 sm:p-5 dark:border-neutral-800"
      >
        <h2 id="rozcestnik" className="text-brand-ink text-xl font-semibold dark:text-neutral-100">
          {t("tocHeading")}
        </h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{t("tocLead")}</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2">
          {SECTION_KEYS.map((key, index) => {
            const Icon = TOC_ICONS[key];
            return (
              <li key={key}>
                <a
                  href={`#${anchor[key]}`}
                  className="bg-brand-tint text-brand-ink hover:border-brand-primary flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm font-medium dark:bg-neutral-900 dark:text-neutral-100"
                >
                  <span
                    aria-hidden
                    className="text-brand-primary flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold dark:bg-neutral-800"
                  >
                    {Icon ? <Icon className="size-4" /> : index + 1}
                  </span>
                  {t(`toc.${key}`)}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* 1 — Getting started */}
      <GuideSection id={anchor.start} heading={t("start.heading")} intro={t("start.intro")}>
        <StepList
          steps={(["open", "password", "look", "keep"] as const).map((key) => ({
            title: t(`start.${key}Title`),
            body: <p>{t(`start.${key}Body`)}</p>,
          }))}
        />
        <SubHeading lead={t("start.termsLead")}>{t("start.termsHeading")}</SubHeading>
        <TermList terms={t.raw("start.terms") as TermEntry[]} />
        <Note>{t("start.buttonsNote")}</Note>
      </GuideSection>

      {/* 2 — Browsing */}
      <GuideSection id={anchor.browse} heading={t("browse.heading")} intro={t("browse.intro")}>
        <SubHeading lead={t.rich("browse.detailLead", glyphs)}>
          {t("browse.detailHeading")}
        </SubHeading>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card className="bg-brand-tint dark:bg-neutral-900">
            <h4 className="text-brand-ink font-semibold dark:text-neutral-100">
              {t("browse.phoneTerm")}
            </h4>
            <CheckList items={t.raw("browse.phone") as string[]} />
          </Card>
          <Card className="bg-brand-tint dark:bg-neutral-900">
            <h4 className="text-brand-ink font-semibold dark:text-neutral-100">
              {t("browse.desktopTerm")}
            </h4>
            <CheckList items={t.raw("browse.desktop") as string[]} />
          </Card>
        </div>

        <SubHeading lead={t("browse.chaptersBody")}>{t("browse.chaptersHeading")}</SubHeading>
        <SubHeading lead={t("browse.highlightsBody")}>{t("browse.highlightsHeading")}</SubHeading>
        <SubHeading lead={t.rich("browse.slideshowBody", glyphs)}>
          {t("browse.slideshowHeading")}
        </SubHeading>
        <Note>{t("browse.slideshowNote")}</Note>
        <Note>{t("browse.newPhotos")}</Note>
      </GuideSection>

      {/* 3 — Print */}
      <GuideSection id={anchor.print} heading={t("print.heading")} intro={t("print.intro")}>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <StepCard
            title={t("print.grid.title")}
            lead={t("print.grid.lead")}
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
          <StepCard
            title={t("print.detail.title")}
            lead={t("print.detail.lead")}
            steps={[
              { title: t("print.detail.openTitle"), body: <p>{t("print.detail.openBody")}</p> },
              {
                title: t("print.detail.tapTitle"),
                body: <p>{t.rich("print.detail.tapBody", glyphs)}</p>,
              },
              { title: t("print.detail.nextTitle"), body: <p>{t("print.detail.nextBody")}</p> },
            ]}
          />
        </div>

        <SubHeading lead={t("print.quantity.lead")}>{t("print.quantity.heading")}</SubHeading>
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
              sizes="36rem"
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
          <CheckList
            items={[
              t.rich("print.quantity.plus", glyphs),
              t.rich("print.quantity.minus", glyphs),
              t("print.quantity.max"),
              t("print.quantity.others"),
            ]}
          />
        </div>

        <SubHeading lead={t("print.summary.lead")}>{t("print.summary.heading")}</SubHeading>
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
        <TermList
          terms={(["photos", "pieces", "everyone", "saved"] as const).map((key) => ({
            term: t(`print.summary.${key}Term`),
            body: t(`print.summary.${key}Body`),
          }))}
        />

        <SubHeading lead={t("print.visibility.lead")}>{t("print.visibility.heading")}</SubHeading>
        <TermList
          terms={(["photographer", "sameLink", "guests"] as const).map((key) => ({
            term: t(`print.visibility.${key}Term`),
            body: t(`print.visibility.${key}Body`),
          }))}
        />
        <Note>{t("print.visibility.hint")}</Note>

        <SubHeading id={anchor.devices} lead={t("print.devices.lead")}>
          {t("print.devices.heading")}
        </SubHeading>
        <StepList
          steps={([1, 2, 3] as const).map((n) => ({
            title: t(`print.devices.step${n}Title`),
            body: <p>{t(`print.devices.step${n}Body`)}</p>,
          }))}
        />
        <CheckList items={t.raw("print.devices.notes") as string[]} />
        <Note>{t("print.devices.togetherHint")}</Note>

        <SubHeading>{t("print.tipsHeading")}</SubHeading>
        <CheckList items={t.raw("print.tips") as TitledEntry[]} />
      </GuideSection>

      {/* 4 — Favourites and reactions */}
      <GuideSection
        id={anchor.favorites}
        heading={t("favorites.heading")}
        intro={t("favorites.intro")}
      >
        <SubHeading>{t("favorites.howHeading")}</SubHeading>
        <CheckList items={[t.rich("favorites.phone", glyphs), t("favorites.desktop")]} />

        <SubHeading lead={t("favorites.filterBody")}>{t("favorites.filterHeading")}</SubHeading>
        <Note>{t("favorites.countBody")}</Note>

        <SubHeading lead={t("favorites.reactionsBody")}>
          {t("favorites.reactionsHeading")}
        </SubHeading>

        <Note>
          {t.rich("favorites.devicesNote", {
            a: (chunks) => (
              <a href={`#${anchor.devices}`} className={linkClasses}>
                {chunks}
              </a>
            ),
          })}
        </Note>
        <Note>{t("favorites.missing")}</Note>
      </GuideSection>

      {/* 5 — Downloads */}
      <GuideSection
        id={anchor.download}
        heading={t("download.heading")}
        intro={t("download.intro")}
      >
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <StepCard
            title={t("download.oneTitle")}
            steps={[
              { title: t("download.oneOpenTitle"), body: <p>{t("download.oneOpenBody")}</p> },
              {
                title: t("download.oneTapTitle"),
                body: <p>{t.rich("download.oneTapBody", glyphs)}</p>,
              },
            ]}
          />
          <StepCard
            title={t("download.someTitle")}
            steps={[
              {
                title: t("download.someSelectTitle"),
                body: (
                  <>
                    <p>{t("download.someSelectPhone")}</p>
                    <p>{t.rich("download.someSelectDesktop", glyphs)}</p>
                  </>
                ),
              },
              {
                title: t("download.someDownloadTitle"),
                body: <p>{t("download.someDownloadBody")}</p>,
              },
            ]}
          />
          <StepCard
            className="sm:col-span-2"
            title={t("download.allTitle")}
            steps={[{ title: t("download.allTapTitle"), body: <p>{t("download.allTapBody")}</p> }]}
          />
        </div>
        <SubHeading>{t("download.tipsHeading")}</SubHeading>
        <CheckList items={t.raw("download.tips") as TitledEntry[]} />
      </GuideSection>

      {/* 6 — Corrections (docs/CORRECTIONS.md) */}
      <GuideSection
        id={anchor.corrections}
        heading={t("corrections.heading")}
        intro={t("corrections.intro")}
      >
        <div className="mt-6">
          <StepCard
            title={t("corrections.stepsTitle")}
            steps={[
              {
                title: t("corrections.enterTitle"),
                body: <p>{t.rich("corrections.enterBody", glyphs)}</p>,
              },
              { title: t("corrections.openTitle"), body: <p>{t("corrections.openBody")}</p> },
              { title: t("corrections.writeTitle"), body: <p>{t("corrections.writeBody")}</p> },
            ]}
          />
        </div>
        <SubHeading lead={t("corrections.editBody")}>{t("corrections.editHeading")}</SubHeading>
        <SubHeading lead={t("corrections.doneBody")}>{t("corrections.doneHeading")}</SubHeading>
        <Note>{t("corrections.badgeNote")}</Note>
        <Note>{t("corrections.missing")}</Note>
      </GuideSection>

      {/* 7 — Guest uploads */}
      <GuideSection id={anchor.guests} heading={t("guests.heading")} intro={t("guests.intro")}>
        <StepList
          steps={(["add", "name", "wait"] as const).map((key) => ({
            title: t(`guests.${key}Title`),
            body: <p>{t(`guests.${key}Body`)}</p>,
          }))}
        />
        <SubHeading>{t("guests.tipsHeading")}</SubHeading>
        <CheckList items={t.raw("guests.tips") as TitledEntry[]} />
        <SubHeading lead={t("guests.hubBody")}>{t("guests.hubHeading")}</SubHeading>
      </GuideSection>

      {/* 8 — Offline */}
      <GuideSection id={anchor.offline} heading={t("offline.heading")} intro={t("offline.intro")}>
        <StepList
          steps={(["scroll", "tap", "save"] as const).map((key) => ({
            title: t(`offline.${key}Title`),
            body: <p>{t(`offline.${key}Body`)}</p>,
          }))}
        />
        <CheckList items={t.raw("offline.tips") as string[]} />
      </GuideSection>

      {/* 9 — Name and privacy */}
      <GuideSection id={anchor.privacy} heading={t("privacy.heading")} intro={t("privacy.intro")}>
        <TermList terms={t.raw("privacy.terms") as TermEntry[]} />
        <Note>{t("privacy.countsNote")}</Note>
        <SubHeading lead={t("privacy.optOutBody")}>{t("privacy.optOutHeading")}</SubHeading>
        <Note>{t("privacy.optOutWarning")}</Note>
      </GuideSection>

      {/* 10 — Troubleshooting */}
      <GuideSection id={anchor.trouble} heading={t("trouble.heading")}>
        <CheckList items={t.raw("trouble.items") as TitledEntry[]} />
      </GuideSection>

      <Card className="bg-brand-tint mt-14 mb-12 dark:bg-neutral-900">
        <p className="text-brand-ink text-sm dark:text-neutral-100">
          {t.rich("help", {
            a: (chunks) => (
              <a href={`mailto:${tFooter("email")}`} className={linkClasses}>
                {chunks}
              </a>
            ),
          })}
        </p>
      </Card>

      <footer className="border-brand-border/60 border-t pt-8 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-500">
        {/* A Client Component reading its own provider — scoped to the page's language too. */}
        <NextIntlClientProvider locale={locale} messages={{ siteFooter: messages.siteFooter }}>
          <SiteFooterIdentity className="text-xs" guideLink={false} />
        </NextIntlClientProvider>
      </footer>
    </main>
  );
}
