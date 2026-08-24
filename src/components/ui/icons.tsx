type IconProps = { className?: string };

const DEFAULT_SIZE = "h-5 w-5";

/**
 * Small stroke-based icon set for the lightbox chrome. SVG rather than text
 * glyphs (‹ › ✕) so every icon has the same stroke weight and centers
 * identically inside a fixed-size circular button — text glyphs carry their
 * own font metrics/baseline, which is what made those buttons render as
 * "eggs" instead of circles.
 */
export function ChevronLeftIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CloseIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function CheckIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

/** Filled "selected" state for the select toggle — CheckIcon is its unselected counterpart. */
export function CheckCircleIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="M7.5 12.3l3 3 6-6.2"
        stroke="white"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function DownloadIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
    </svg>
  );
}

/** Live projection ("Projekce") — a screen on a stand. */
export function ProjectorIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/** Offline access — an arrow saving into a device, distinct from DownloadIcon's tray. */
export function OfflineIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v6m0 0-3-3m3 3 3-3" />
    </svg>
  );
}

export function HeartIcon({
  className = DEFAULT_SIZE,
  active = false,
}: IconProps & { active?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 20.3c-.3 0-.6-.1-.8-.3C7.3 16.9 3 13 3 8.9 3 5.9 5.2 4 8 4c1.7 0 3.2.9 4 2.3C12.8 5 14.3 4 16 4c2.8 0 5 1.9 5 4.9 0 4.1-4.3 8-8.2 11.1-.2.2-.5.3-.8.3Z" />
    </svg>
  );
}

/** Print selection — the paper tray between the two sheets is what reads as a printer at small size. */
export function PrinterIcon({ className = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M7 8V4h10v4" />
      <rect x="4" y="8" width="16" height="8" rx="1.5" />
      <path d="M7 14h10v6H7z" />
    </svg>
  );
}
