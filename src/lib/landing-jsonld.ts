import { LOCALE_TAGS, type Locale } from "@/i18n/locales";
import { OG_SITE_NAME } from "@/lib/og-image";
import { SITE_ORIGIN } from "@/lib/site-url";

/**
 * The business and the person behind it, as the main site defines them
 * (svatebni-fotograf-cechy.cz home page JSON-LD, checked 2026-10-05). The facts
 * — address, phone, sameAs, prices — live there and only there; this page
 * refers to them by `@id` so the two properties describe one entity instead of
 * two that drift apart (docs/AI-VISIBILITY.md, "Decisions for this repo").
 * `name` and `url` are repeated only so a reader that does not follow `@id`
 * across sites still knows who publishes the page.
 */
const MAIN_SITE = "https://svatebni-fotograf-cechy.cz";
export const BUSINESS_ID = `${MAIN_SITE}/#organization`;
export const PERSON_ID = `${MAIN_SITE}/#person`;

export interface FaqEntry {
  q: string;
  a: string;
}

/**
 * Structured data for the help page at `/`: the page itself (an FAQPage, which
 * is a WebPage), the site it belongs to, and who publishes it. All content
 * comes from the message catalogs, never from user input.
 */
export function landingJsonLd({
  locale,
  title,
  description,
  faq,
}: {
  locale: Locale;
  title: string;
  description: string;
  faq: FaqEntry[];
}) {
  const websiteId = `${SITE_ORIGIN}/#website`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        "@id": `${SITE_ORIGIN}/#webpage`,
        // Same form as the canonical link Next renders for `/` — no trailing slash.
        url: SITE_ORIGIN,
        name: title,
        description,
        inLanguage: LOCALE_TAGS[locale],
        isPartOf: { "@id": websiteId },
        publisher: { "@id": BUSINESS_ID },
        author: { "@id": PERSON_ID },
        mainEntity: faq.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: SITE_ORIGIN,
        name: OG_SITE_NAME,
        publisher: { "@id": BUSINESS_ID },
      },
      {
        "@type": "ProfessionalService",
        "@id": BUSINESS_ID,
        name: "Pavel Prokeš – Svatební fotograf",
        url: MAIN_SITE,
        founder: { "@id": PERSON_ID },
      },
      {
        "@type": "Person",
        "@id": PERSON_ID,
        name: "Pavel Prokeš",
        url: `${MAIN_SITE}/svatebni-fotograf-pavel-prokes`,
      },
    ],
  };
}
