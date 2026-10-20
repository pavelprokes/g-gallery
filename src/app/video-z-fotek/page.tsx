import type { Metadata } from "next";
import { SlideshowPage, slideshowMetadata } from "./slideshow-page";

export function generateMetadata(): Metadata {
  return slideshowMetadata("cs");
}

export default function CzechSlideshowPage() {
  return <SlideshowPage locale="cs" />;
}
