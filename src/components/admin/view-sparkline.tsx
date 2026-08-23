import { FORMS, pluralize } from "@/lib/czech-plural";
import type { DayPoint, ViewSeries } from "@/lib/view-series";

/**
 * Fourteen days of visits beside a list row: how many *people* opened it each
 * day, and how many of that day's visits were someone coming back.
 *
 * Two shades of one hue rather than two hues. The series are not two different
 * things — they are one measure (a visit) split by whether the visitor had
 * already been there that day, and they stack into that day's total. A second
 * hue would claim an identity relationship that isn't there, and the brand's
 * terracotta is too low-chroma to pair safely with one anyway (it fails the
 * chroma floor as a categorical slot, so any partner hue starts from a
 * disadvantage under colour-vision deficiency). Light-vs-dark of the same hue
 * survives every CVD simulation, greyscale printing, and a 6px column.
 *
 * Every value is also printed as text next to the chart — the SVG enhances the
 * numbers, it never gates them.
 */

/** Both steps of the ordinal ramp, mirrored from the brand terracotta. */
const UNIQUE_FILL = "#825238"; // brand-primary — 6.5:1 on the white card
const REPEAT_FILL = "#c9a48d"; // a lighter step of the same hue — 2.3:1, above the 2:1 ordinal floor
/** The hairline the columns stand on — it shows how far back the window goes,
 *  so a row with two quiet weeks still reads as a chart rather than as nothing. */
const BASELINE_FILL = "#e6dad2"; // admin-border

const BAND = 8; // one day
const GAP = 2; // the surface gap between days — and between the two segments
const BAR = BAND - GAP;
const HEIGHT = 32;
const RADIUS = 3;

/** A column with its data-end rounded and its baseline square. */
function columnPath(x: number, y: number, height: number, rounded: boolean): string {
  const r = rounded ? Math.min(RADIUS, BAR / 2, height) : 0;
  const bottom = y + height;
  if (r === 0) return `M${x} ${y}h${BAR}v${height}h${-BAR}z`;
  return `M${x} ${bottom}v${-(height - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${BAR - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${height - r}z`;
}

/** Segment heights for one day, at the page's shared scale. */
function segments(point: DayPoint, max: number): { unique: number; repeat: number } {
  const scale = HEIGHT / max;
  // A single visit must stay visible next to a day that had forty, so anything
  // non-zero gets at least the 2px the surface gap is wide.
  let unique = point.unique > 0 ? Math.max(2, Math.round(point.unique * scale)) : 0;
  let repeat = point.repeat > 0 ? Math.max(2, Math.round(point.repeat * scale)) : 0;
  const separator = unique > 0 && repeat > 0 ? GAP : 0;

  // Rounding up to that minimum can push the tallest column past the plot;
  // give the space back from the top segment first.
  let over = unique + repeat + separator - HEIGHT;
  if (over > 0 && repeat > 0) {
    const cut = Math.min(over, repeat - 2);
    repeat -= cut;
    over -= cut;
  }
  if (over > 0 && unique > 0) unique -= Math.min(over, unique - 2);

  return { unique, repeat };
}

/** "2026-08-23" → "23. 8." — the key is already a Prague calendar date. */
function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${Number(date)}. ${Number(month)}.`;
}

/** What hovering one column says. */
function dayTooltip(point: DayPoint): string {
  if (point.unique === 0 && point.repeat === 0) return `${shortDay(point.day)} — nikdo se nedíval`;
  const repeat = point.repeat > 0 ? `, ${pluralize(point.repeat, FORMS.repeatVisit)}` : "";
  return `${shortDay(point.day)} — ${pluralize(point.unique, FORMS.viewer)}${repeat}`;
}

export function ViewSparkline({
  series,
  max,
  label,
}: {
  series: ViewSeries;
  /** The tallest column on the page — see `seriesMax`. */
  max: number;
  /** What this row is, for the screen-reader summary ("Svatba Anna a Petr"). */
  label: string;
}) {
  const width = series.points.length * BAND - GAP;

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width={width}
      height={HEIGHT}
      role="img"
      aria-label={`${label}: za posledních 14 dní ${pluralize(series.unique, FORMS.viewer)} a ${pluralize(series.repeat, FORMS.repeatVisit)}`}
      className="shrink-0 overflow-visible"
    >
      {/* The baseline is drawn, not implied: without it a fortnight with one
          quiet visit looks like a rendering failure rather than a quiet week. */}
      <rect x={0} y={HEIGHT - 1} width={width} height={1} fill={BASELINE_FILL} />
      {series.points.map((point, index) => {
        const x = index * BAND;
        const { unique, repeat } = segments(point, max);
        const uniqueY = HEIGHT - unique;
        const repeatY = uniqueY - (unique > 0 ? GAP : 0) - repeat;

        return (
          <g key={point.day}>
            {/* One template string, not JSX children: React only accepts a
                single text node inside <title>. */}
            <title>{dayTooltip(point)}</title>
            {unique > 0 && (
              <path d={columnPath(x, uniqueY, unique, repeat === 0)} fill={UNIQUE_FILL} />
            )}
            {repeat > 0 && <path d={columnPath(x, repeatY, repeat, true)} fill={REPEAT_FILL} />}
            {/* The hit target for the tooltip is the whole day, gap included —
                a 6px column is not something anyone lands on deliberately. */}
            <rect x={x - GAP / 2} y={0} width={BAND} height={HEIGHT} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}

/** The colour key. Sits once above a list, not on every row. */
export function ViewSparklineLegend({ className = "" }: { className?: string }) {
  return (
    <p
      className={`text-admin-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${className}`}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: UNIQUE_FILL }}
        />
        diváci
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: REPEAT_FILL }}
        />
        opakované návštěvy
      </span>
      <span>· posledních 14 dní, řádky v seznamu sdílí měřítko</span>
    </p>
  );
}
