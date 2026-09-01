"use client";

import { useTranslations } from "next-intl";
import { type GalleryPromo, isSafePromoUrl, promoCtaFallback } from "@/lib/promo-card";

/**
 * The photographer's credit tile, sitting in the grid where a landscape photo
 * would be.
 *
 * Three things it deliberately is not:
 *
 *   - **Not an image.** A second picture competing with the wedding photos
 *     around it is exactly what makes a gallery look like a website with ads
 *     in it. This is type on a flat ground, and it stays that way.
 *   - **Not a photo.** It carries no photo index, so it cannot be opened,
 *     selected, favourited, marked for print or zipped (`src/lib/gallery-grid.ts`).
 *   - **Not arrow-navigable.** The roving tabindex covers photos only; this is
 *     a plain Tab stop, like any other link on the page.
 *
 * ## Why the type scales with container queries rather than viewport ones
 *
 * The tile is as wide as the justified row made it, which depends on the
 * aspect ratios of the photos it shares the row with — not on the viewport.
 * The same phone can therefore render this tile at 190 px in one gallery and
 * 300 px in another. `cqi` units resolve against the tile's own inline size,
 * so the headline is always the right size *for the box it is in*, with no
 * measurement, no JS, and no resize listener. `clamp()` keeps it readable at
 * the extremes.
 */
export function PromoTile({
  promo,
  width,
  height,
}: {
  promo: GalleryPromo;
  width: number;
  height: number;
}) {
  const t = useTranslations("promo");

  // Checked again on render, not only on write: a row can predate a validation
  // rule, and a bad href here would land in pages held by people who are not
  // the owner. Dropping the tile is the safe failure — the grid simply has one
  // fewer entry, which nobody can tell from the outside.
  if (!isSafePromoUrl(promo.ctaUrl)) return null;

  const theme = THEMES[promo.theme] ?? THEMES.LIGHT;
  const ctaLabel = promo.ctaLabel?.trim() || promoCtaFallback(promo.ctaUrl);

  return (
    <div
      className="group/promo @container relative shrink-0 overflow-hidden select-none"
      style={{ width, height }}
      data-promo-tile={promo.id}
    >
      <a
        href={promo.ctaUrl}
        target="_blank"
        // `noopener` is the security half; `noreferrer` keeps the share token
        // in the URL from being handed to the photographer's own analytics as
        // a Referer (CLAUDE.md invariant #7 — tokens must not leak off-site).
        rel="noopener noreferrer"
        className={`flex h-full w-full flex-col justify-between overflow-hidden text-left ${theme.surface}`}
        style={{
          // Padding tracks the tile, so a 190 px phone tile is not eaten by a
          // gutter sized for a 340 px desktop one.
          padding: "clamp(0.625rem, 5.5cqi, 1.75rem)",
        }}
        aria-label={t("cardAriaLabel", { headline: promo.headline, cta: ctaLabel })}
      >
        <div className="min-h-0">
          {promo.eyebrow && (
            <p
              // Hidden on the smallest tiles: below ~200 px the eyebrow costs a
              // line the headline needs more.
              className={`truncate font-semibold tracking-[0.14em] uppercase @max-[13rem]:hidden ${theme.eyebrow}`}
              style={{ fontSize: "clamp(0.5rem, 2.5cqi, 0.75rem)", lineHeight: 1.5 }}
            >
              {promo.eyebrow}
            </p>
          )}

          <p
            className={`mt-[0.35em] font-semibold text-balance ${theme.headline}`}
            style={{
              fontSize: "clamp(0.8125rem, 6.4cqi, 1.875rem)",
              lineHeight: 1.22,
              // Czech stacks caron and acute above the x-height; a serif
              // headline at 1.22 needs the extra room or `ě`/`ů` clip.
              paddingTop: "0.06em",
            }}
          >
            {promo.headline}
          </p>

          {promo.body && (
            <p
              // Two lines on a phone tile, three once there is room for them.
              className={`mt-[0.6em] line-clamp-2 @max-[15rem]:hidden @min-[20rem]:line-clamp-3 ${theme.body}`}
              style={{ fontSize: "clamp(0.625rem, 3.1cqi, 0.9375rem)", lineHeight: 1.55 }}
            >
              {promo.body}
            </p>
          )}
        </div>

        <p
          className={`mt-[0.5em] flex shrink-0 items-center gap-[0.5em] font-semibold ${theme.cta}`}
          style={{ fontSize: "clamp(0.625rem, 3.2cqi, 0.9375rem)", lineHeight: 1.4 }}
        >
          <span className="truncate underline decoration-from-font underline-offset-[0.3em]">
            {ctaLabel}
          </span>
          <PromoArrow />
        </p>
      </a>
    </div>
  );
}

/**
 * The one piece of motion on the tile: a 10 px arrow that slides a third of
 * its own width on hover and on keyboard focus of the link.
 *
 * Compositor-only (`transform` on an SVG group), a single property, and
 * governed by the global `prefers-reduced-motion` reset in `globals.css`,
 * which flattens the transition to an instant state change rather than
 * removing the affordance. Sized in `em` so it scales with the CTA text the
 * container query already sized.
 */
function PromoArrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0 overflow-visible"
      style={{ width: "1.1em", height: "1.1em" }}
    >
      <g className="transition-transform duration-200 ease-out group-hover/promo:translate-x-[3px] group-focus-visible/promo:translate-x-[3px]">
        <path
          d="M2.5 8h10"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M9 4.5 12.5 8 9 11.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}

/**
 * Three fixed looks, all built from the brand tokens in `globals.css`.
 *
 * No colour picker on purpose: the tile shares a row with the photographs, and
 * the one thing it must never do is clash with them. Each pairing is above
 * 7:1 for the headline and above 4.5:1 for the body — the tile can land next
 * to a bright dress or a dark church interior and still be readable, because
 * it brings its own ground rather than sitting on a photo.
 */
const THEMES: Record<GalleryPromo["theme"], Record<string, string>> = {
  LIGHT: {
    surface: "bg-brand-tint",
    eyebrow: "text-brand-primary",
    headline: "text-brand-ink",
    body: "text-brand-ink/75",
    cta: "text-brand-primary-dark",
  },
  DARK: {
    surface: "bg-brand-ink",
    eyebrow: "text-brand-border",
    headline: "text-brand-tint",
    body: "text-brand-tint/75",
    cta: "text-brand-border",
  },
  BRAND: {
    surface: "bg-brand-primary",
    eyebrow: "text-white/80",
    headline: "text-white",
    body: "text-white/85",
    cta: "text-white",
  },
};
