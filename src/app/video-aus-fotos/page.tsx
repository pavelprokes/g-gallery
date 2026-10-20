import type { Metadata } from "next";
import { SlideshowPage, slideshowMetadata } from "../video-z-fotek/slideshow-page";

export function generateMetadata(): Metadata {
  return slideshowMetadata("de");
}

export default function GermanSlideshowPage() {
  return <SlideshowPage locale="de" />;
}
