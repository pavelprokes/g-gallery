import type { Metadata } from "next";
import { SlideshowPage, slideshowMetadata } from "../video-z-fotek/slideshow-page";

export function generateMetadata(): Metadata {
  return slideshowMetadata("pl");
}

export default function PolishSlideshowPage() {
  return <SlideshowPage locale="pl" />;
}
