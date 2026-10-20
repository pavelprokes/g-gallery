import type { Metadata } from "next";
import { SlideshowPage, slideshowMetadata } from "../video-z-fotek/slideshow-page";

export function generateMetadata(): Metadata {
  return slideshowMetadata("sk");
}

export default function SlovakSlideshowPage() {
  return <SlideshowPage locale="sk" />;
}
