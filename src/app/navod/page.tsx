import type { Metadata } from "next";
import { GuidePage, guideMetadata } from "./guide-page";

export function generateMetadata(): Metadata {
  return guideMetadata("cs");
}

export default function CzechGuidePage() {
  return <GuidePage locale="cs" />;
}
