import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import { LocaleSwitcher } from "@/components/locale-switcher";
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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("marketing");
  const title = t("pageTitle");
  const description = t("pageDescription");

  return {
    title,
    description,
    alternates: { canonical: "/" },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: "/",
      siteName: "g-gallery",
      locale: locale === "en" ? "en_US" : "cs_CZ",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

const MAIN_SITE_URL = "https://svatebni-fotograf-cechy.cz/";

const HIGHLIGHT_ICONS = {
  download: DownloadIcon,
  projector: ProjectorIcon,
} as const;

interface FaqEntry {
  q: string;
  a: string;
}

interface StepEntry {
  title: string;
  body: string;
}

export default async function Home() {
  const t = await getTranslations("marketing");
  const faq = t.raw("faq") as FaqEntry[];
  const guestTips = t.raw("guestTips") as string[];
  const features = t.raw("features") as string[];
  const howItWorksSteps = t.raw("howItWorksSteps") as StepEntry[];

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({
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

      <div className="mb-6 flex justify-end sm:mb-8">
        <LocaleSwitcher />
      </div>

      <header className="grid gap-8 sm:grid-cols-[1.2fr_1fr] sm:items-center">
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
            {t("backToMainSite")}
          </a>
        </div>
        <Image
          src="/iphone-mockup.webp"
          alt={t("heroImageAlt")}
          width={1000}
          height={2073}
          sizes="(max-width: 640px) 14rem, 40vw"
          priority
          className="mx-auto h-auto w-full max-w-56 sm:max-w-none"
        />
      </header>

      <section aria-labelledby="dva-zpusoby" className="mt-14 mb-12">
        <h2 id="dva-zpusoby" className="text-brand-ink text-xl font-semibold dark:text-neutral-100">
          {t("twoWaysHeading")}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card className="bg-brand-tint dark:bg-neutral-900">
            <p className="text-brand-ink font-medium dark:text-neutral-100">
              {t("fromPhotographerTitle")}
            </p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {t("fromPhotographerBody")}
            </p>
          </Card>
          <Card className="bg-brand-tint dark:bg-neutral-900">
            <p className="text-brand-ink font-medium dark:text-neutral-100">
              {t("fromGuestsTitle")}
            </p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {t("fromGuestsBody")}
            </p>
          </Card>
        </div>
      </section>

      <section aria-labelledby="jak-to-funguje" className="mb-12">
        <h2
          id="jak-to-funguje"
          className="text-brand-ink text-xl font-semibold dark:text-neutral-100"
        >
          {t("howItWorksHeading")}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {howItWorksSteps.map(({ title, body }) => (
            <Card key={title} className="bg-brand-tint dark:bg-neutral-900">
              <p className="text-brand-ink font-medium dark:text-neutral-100">{title}</p>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="highlighty" className="mb-12">
        <h2 id="highlighty" className="text-brand-ink text-xl font-semibold dark:text-neutral-100">
          {t("highlightsHeading")}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(Object.keys(HIGHLIGHT_ICONS) as (keyof typeof HIGHLIGHT_ICONS)[]).map((key) => {
            const Icon = HIGHLIGHT_ICONS[key];
            return (
              <Card
                key={key}
                className="border-brand-primary/30 flex gap-3 bg-white dark:bg-neutral-900"
              >
                <Icon className="text-brand-primary mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="text-brand-ink font-medium dark:text-neutral-100">
                    {t(`highlights.${key}.title`)}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {t(`highlights.${key}.body`)}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="napoveda" className="mb-12">
        <h2 id="napoveda" className="text-brand-ink text-xl font-semibold dark:text-neutral-100">
          {t("faqHeading")}
        </h2>
        <div className="divide-brand-border/60 border-brand-border/60 mt-4 divide-y rounded-lg border dark:divide-neutral-800 dark:border-neutral-800">
          {faq.map(({ q, a }) => (
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
          {t("guestTipsHeading")}
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{t("guestTipsIntro")}</p>
        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.3fr] sm:items-start">
          <Image
            src="/qr-sign-table.webp"
            alt={t("guestTipsImageAlt")}
            width={900}
            height={600}
            sizes="(max-width: 640px) 100vw, 40vw"
            className="aspect-[3/2] rounded-xl object-cover"
          />
          <ul className="space-y-3">
            {guestTips.map((tip) => (
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
          {t("featuresHeading")}
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{t("featuresIntro")}</p>
        <ol className="mt-4 space-y-3">
          {features.map((feature, index) => (
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
        {t("footerText")}{" "}
        <a
          href={MAIN_SITE_URL}
          className="text-brand-primary hover:text-brand-primary-dark font-medium underline underline-offset-4"
        >
          {t("footerLinkText")}
        </a>
      </footer>
    </main>
  );
}
