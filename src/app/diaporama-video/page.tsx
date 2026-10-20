import type { Metadata } from "next";
import { SlideshowPage, slideshowMetadata } from "../video-z-fotek/slideshow-page";

export function generateMetadata(): Metadata {
  return slideshowMetadata("fr");
}

export default function FrenchSlideshowPage() {
  return <SlideshowPage locale="fr" />;
}
