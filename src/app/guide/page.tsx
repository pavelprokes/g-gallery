import type { Metadata } from "next";
import { GuidePage, guideMetadata } from "../navod/guide-page";

export function generateMetadata(): Metadata {
  return guideMetadata("en");
}

export default function EnglishGuidePage() {
  return <GuidePage locale="en" />;
}
