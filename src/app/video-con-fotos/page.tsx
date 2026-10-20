import type { Metadata } from "next";
import { SlideshowPage, slideshowMetadata } from "../video-z-fotek/slideshow-page";

export function generateMetadata(): Metadata {
  return slideshowMetadata("es");
}

export default function SpanishSlideshowPage() {
  return <SlideshowPage locale="es" />;
}
