import { buttonClasses } from "@/components/ui/button";

/**
 * Opens the gallery as a guest sees it, in a new tab — the admin is where the
 * photographer goes to find a gallery's link, so the gallery itself is one
 * click away from every place that lists it.
 */
export function OpenGalleryLink({
  href,
  size = "md",
  label = "Otevřít galerii",
  variant = "primary",
}: {
  href: string;
  size?: "sm" | "md";
  label?: string;
  /** Primary only in a page's header — one primary per page; rows in a list are secondary. */
  variant?: "primary" | "secondary";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses(variant, size)}
    >
      {label} ↗
    </a>
  );
}
