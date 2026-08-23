"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Variant = "table" | "corner";

/**
 * Guest-facing copy (docs/GUEST-GALLERIES.md F7 / GUEST-GALLERIES-RESEARCH.md
 * §10, restyled after direct feedback the first pass read as a generic
 * utility printout). Gender-neutral by construction on purpose — round-1
 * copywriter review flagged that a gendered participle ("vyfotil/a") is a
 * snag a printed object can never patch after the fact the way an app string
 * can.
 *
 * The CTA line is identical across variants on purpose (round-2 copywriter
 * finding): a guest who saw one sign should recognise the same action
 * instantly on the other. Only the headline and the reassurance caption
 * change by placement — the table card drops the caption entirely to stay a
 * three-second read, the photo-corner sign has room to keep it.
 *
 * Round 3 (Pavel: the warmer round-2 rewrite no longer made clear this is a
 * shared *gallery*, or that anyone who took a photo can add to it): "gallery"
 * now appears in the kicker (below) and in both headlines, and "anyone, no
 * gatekeeping" is explicit in the corner caption — redundant on purpose,
 * since that was exactly the fact that wasn't landing.
 */
const COPY: Record<
  Variant,
  { label: string; headline: string; cta: string; caption: string | null }
> = {
  table: {
    label: "Na stůl (kratší)",
    headline: "Dnes fotíš i ty — přidej se do galerie.",
    cta: "Nahraj fotky →",
    caption: null,
  },
  corner: {
    label: "Do fotokoutku (delší)",
    headline: "Nejkrásnější momenty večera možná neuvidíme. Nahraj svoje do naší galerie.",
    cta: "Nahraj fotky →",
    caption: "Bez appky, bez přihlašování — přidá kdokoli s telefonem.",
  },
};

/**
 * One printable QR sign, previewed and printed from the admin
 * (docs/GUEST-GALLERIES.md F7). A single fixed layout on purpose — round-1
 * findings converged on "one clean design with a real quiet zone" over
 * GuestPix's 180-template approach, which is explicitly out of scope for this
 * pass. `window.print()` and `@media print`, not a generated PDF: the browser
 * already does this for free, and "print → save as PDF" is something every
 * photographer already knows from every other web tool.
 *
 * Restyled round 2 (Pavel: "strohé a nevýrazné", wanted the site's own look)
 * to actually use the brand — `.font-brand` (Bitter, src/lib/fonts.ts),
 * `brand-primary`/`brand-ink`/`brand-tint` (src/app/globals.css), and the
 * real site's own CTA-button pattern ("Check date availability →"). The QR
 * module itself stays untouched: pure black on white, no tint — round-1 QA
 * and photographer findings agreed contrast under bad reception lighting is
 * not a place to spend brand personality.
 */
export function PrintableSign({
  url,
  qrSvg,
  targetLabel,
  readinessNote,
}: {
  /** The full absolute URL encoded in the QR — also shown as plain text under it. */
  url: string;
  /** Server-rendered QR SVG markup (src/lib/qr.ts). */
  qrSvg: string;
  /** What this sign points at — printed as a small kicker line, and used in the preview-only readiness note. */
  targetLabel: string;
  /** Round-1 groom-persona ask: confirm what's live before trusting a print run. Preview only. */
  readinessNote?: { ok: boolean; text: string };
}) {
  const [variant, setVariant] = useState<Variant>("table");
  const copy = COPY[variant];

  return (
    <div>
      {/* A6 card, flat (not a fold-over tent) — kept deliberately simple for v1. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: 105mm 148mm; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          #printable-sign {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            width: 105mm !important;
            height: 148mm !important;
            margin: 0 !important;
          }
        }
      `}</style>

      <div className="no-print mb-6 flex flex-wrap items-center gap-3">
        {(Object.keys(COPY) as Variant[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setVariant(key)}
            aria-pressed={variant === key}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              variant === key
                ? "border-brand-primary bg-brand-tint text-brand-ink"
                : "hover:border-brand-primary border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
            }`}
          >
            {COPY[key].label}
          </button>
        ))}
        <Button onClick={() => window.print()}>Vytisknout</Button>
      </div>

      {readinessNote && (
        // Semantic status colors, not brand — same rule src/components/ui/alert.tsx
        // already documents: success/warning are universal, not brand-tinted.
        <p
          className={`no-print mb-2 text-sm ${
            readinessNote.ok
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-500"
          }`}
        >
          Vede na: {targetLabel} · {readinessNote.text}
        </p>
      )}

      {/* Round-2 photographer finding: warm brand colors can drift on a home
          inkjet printer more than plain black text does. */}
      <p className="no-print mb-6 text-xs text-neutral-500">
        Tip: barvy se na inkoustových tiskárnách někdy posouvají. Než vytiskneš víc kopií, zkus
        nejdřív jednu na svůj papír.
      </p>

      <div
        id="printable-sign"
        className="font-brand border-brand-border/60 bg-brand-tint mx-auto flex flex-col items-center justify-between gap-5 rounded-lg border p-8 text-center shadow-sm"
        style={{ width: "105mm", minHeight: "148mm" }}
      >
        <div>
          <p className="text-brand-primary text-xs font-semibold tracking-[0.15em] uppercase">
            {targetLabel} · sdílená galerie
          </p>
          <p className="text-brand-ink mt-2 text-xl leading-snug font-semibold">{copy.headline}</p>
        </div>

        {/* An explicit white panel, not just the QR's own painted background —
            keeps the code's contrast unambiguous even printed on tinted stock. */}
        <div className="rounded-md bg-white p-3 shadow-sm">
          <div
            role="img"
            aria-label={`QR kód na galerii ${targetLabel}`}
            className="h-[40mm] w-[40mm] [&>svg]:h-full [&>svg]:w-full"
            // The server-rendered SVG is built from our own token-derived URL
            // (src/lib/qr.ts), never from guest- or client-supplied text.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        </div>

        <div className="flex flex-col items-center gap-2">
          {/* A real link on screen (round-2 synthesis of the groom-persona
              "let me test it myself" ask) — inert on paper regardless, since
              paper has no clicks. */}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="bg-brand-primary hover:bg-brand-primary-dark rounded-full px-5 py-2 text-sm font-semibold text-white no-underline transition-colors"
          >
            {copy.cta}
          </a>
          {copy.caption && <p className="text-brand-ink/70 text-sm">{copy.caption}</p>}
          {/* Not meant to be typed — a legible fallback and proof the code is
              real, per round-1 photographer findings (skeptical-guest case).
              /70 not /40: at this small size /40 measures ~2.4:1 against the
              tinted card background, below WCAG 2.1 AA's 4.5:1 text minimum. */}
          <p className="text-brand-ink/70 mt-1 text-[10px] break-all">{url}</p>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element -- a small static
            brand mark on a print layout; next/image's runtime cost buys nothing here. */}
        <img src="/brand-mark.svg" alt="" aria-hidden className="h-[8mm] w-[8mm] opacity-80" />
      </div>
    </div>
  );
}
