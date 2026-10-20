import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LOCALES, type Locale } from "@/i18n/locales";
import { GuidePage, guideMetadata } from "../../navod/guide-page";

/** Czech and English have their own addresses (/navod, /guide); the rest live here. */
const UNDER_GUIDE = LOCALES.filter((locale) => locale !== "cs" && locale !== "en");

function guideLocale(lang: string): Locale | null {
  return (UNDER_GUIDE as readonly string[]).includes(lang) ? (lang as Locale) : null;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return UNDER_GUIDE.map((lang) => ({ lang }));
}

export async function generateMetadata(props: PageProps<"/guide/[lang]">): Promise<Metadata> {
  const locale = guideLocale((await props.params).lang);
  if (!locale) notFound();
  return guideMetadata(locale);
}

export default async function TranslatedGuidePage(props: PageProps<"/guide/[lang]">) {
  const locale = guideLocale((await props.params).lang);
  if (!locale) notFound();
  return <GuidePage locale={locale} />;
}
