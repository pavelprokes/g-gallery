"use client";

import { useTranslations } from "next-intl";
import { type GalleryPromo, isSafePromoUrl, promoCtaFallback } from "@/lib/promo-card";
import { getViewerId } from "@/lib/viewer-id";

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
 *
 * ## Click tracking
 *
 * `token` is optional so the tile stays renderable without it (tests, previews,
 * any future surface that has no share link). Without one there is nothing to
 * report to and the tile is simply silent — the link works either way, which is
 * the property that matters here.
 */
export function PromoTile({
  promo,
  width,
  height,
  token,
}: {
  promo: GalleryPromo;
  width: number;
  height: number;
  /** Share token of the gallery this tile is being shown in; enables the
   * click beacon. Never leaves the first party — see `rel` on the link. */
  token?: string;
}) {
  const t = useTranslations("promo");

  /**
   * Tells the photographer whether the card works at all — the one thing they
   * cannot see from the outside (docs/PROMO-CARDS.md).
   *
   * The navigation must not depend on this in any way: no `preventDefault`, no
   * awaiting, no re-dispatching the click after a fetch resolves. `sendBeacon`
   * hands the request to the browser, which delivers it even as this document
   * goes to the background, and returns synchronously; the anchor's default
   * action then happens as it always would, beacon or no beacon.
   */
  function reportClick() {
    if (!token) return;

    const anonKey = getViewerId();
    if (!anonKey) return; // opted out, or no storage — nothing to attribute.

    const payload = JSON.stringify({ anonKey, type: "PROMO_CLICK" });
    const url = `/api/g/${encodeURIComponent(token)}/activity`;

    // Same shape as the gallery's GALLERY_VIEW / PHOTO_VIEW beacons.
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    } else {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {
        // A lost click is not worth an unhandled rejection in a guest's tab.
      });
    }
  }

  // Checked again on render, not only on write: a row can predate a validation
  // rule, and a bad href here would land in pages held by people who are not
  // the owner. Dropping the tile is the safe failure — the grid simply has one
  // fewer entry, which nobody can tell from the outside.
  if (!isSafePromoUrl(promo.ctaUrl)) return null;

  const theme = THEMES[promo.theme] ?? THEMES.LIGHT;
  const ctaLabel = promo.ctaLabel?.trim() || promoCtaFallback(promo.ctaUrl);

  return (
    <div
      className="group/promo promo-focus @container relative shrink-0 overflow-hidden select-none"
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
        onClick={reportClick}
        // Middle-click opens the link in a background tab without firing
        // `click` at all. `auxclick` also fires for the right button, which
        // opens a context menu rather than following the link — hence the guard.
        onAuxClick={(event) => {
          if (event.button === 1) reportClick();
        }}
        // Centred rather than pushed to the edges. `justify-between` pinned the
        // text to the top and the link to the bottom, leaving a void between
        // them on any tile taller than the copy — which made the card read as
        // small even at a perfectly good type size. Centred, it reads as one
        // deliberate block at every tile height.
        className={`flex h-full w-full flex-col justify-center overflow-hidden text-left ${theme.surface}`}
        style={{
          // `safe` keeps centring only while the content fits and switches to
          // start alignment once it overflows — without it, text grown by a
          // user stylesheet or a 200% text setting would be cut off at the
          // *top* as well as the bottom, losing the headline first. A browser
          // that does not understand it drops the declaration and keeps the
          // plain `center` from the class above.
          justifyContent: "safe center",
          // Padding tracks the tile, so a 190 px phone tile is not eaten by a
          // gutter sized for a 340 px desktop one.
          padding: "clamp(0.6rem, 5cqi, 1.5rem)",
        }}
        aria-label={t("cardAriaLabel", { headline: promo.headline, cta: ctaLabel })}
      >
        <div className="min-h-0">
          {promo.eyebrow && (
            <p
              // Hidden on the smallest tiles: below ~200 px the eyebrow costs a
              // line the headline needs more.
              className={`truncate font-semibold tracking-[0.14em] uppercase @max-[13rem]:hidden ${theme.eyebrow}`}
              style={{ fontSize: "clamp(0.625rem, 2.8cqi, 0.8125rem)", lineHeight: 1.5 }}
            >
              {promo.eyebrow}
            </p>
          )}

          <p
            // Deliberately NOT line-clamped. WCAG 2.1 AA 1.4.12 (Text Spacing)
            // requires content to survive a user stylesheet raising
            // line-height to 1.5 with no loss, and 1.4.4 the same at 200%
            // text size — a clamp on the primary content fails both. A
            // headline too long for the tile is an authoring problem the admin
            // preview shows immediately, not one to hide by truncating.
            className={`mt-[0.35em] font-semibold text-balance ${theme.headline}`}
            style={{
              // Every one of these used to bottom out at its `clamp()` floor on
              // a phone tile — 6.4% of 193 px is 12 px, so the `cqi` term did
              // nothing and the floor decided everything. The floors were set
              // for the desktop case and were far too low.
              fontSize: "clamp(1rem, 8.5cqi, 2rem)",
              lineHeight: 1.2,
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
              className={`mt-[0.6em] line-clamp-2 @max-[15rem]:hidden @min-[24rem]:line-clamp-3 ${theme.body}`}
              style={{ fontSize: "clamp(0.8125rem, 4cqi, 1.0625rem)", lineHeight: 1.5 }}
            >
              {promo.body}
            </p>
          )}
        </div>

        <p
          className={`mt-[0.9em] flex shrink-0 items-center gap-[0.5em] font-semibold ${theme.cta}`}
          style={{ fontSize: "clamp(0.75rem, 4cqi, 1rem)", lineHeight: 1.4 }}
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
