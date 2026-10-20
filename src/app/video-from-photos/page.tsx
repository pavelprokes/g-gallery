import type { Metadata } from "next";
import { SlideshowPage, slideshowMetadata } from "../video-z-fotek/slideshow-page";

export function generateMetadata(): Metadata {
  return slideshowMetadata("en");
}

export default function EnglishSlideshowPage() {
  return <SlideshowPage locale="en" />;
}
