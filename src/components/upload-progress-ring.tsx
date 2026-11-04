/**
 * The guest uploader's determinate ring. `progress` is a fraction of the run's
 * bytes (0–1), so it moves while a big photo is still on the wire instead of
 * jumping once per file.
 *
 * With `labelledBy` it is a real `progressbar` — screen readers can ask it how
 * far along the upload is, and globals.css keeps its fill animating under
 * reduced motion. Without a label it is decoration and stays hidden.
 */
export function UploadProgressRing({
  progress,
  labelledBy,
  className = "size-6",
}: {
  progress: number;
  labelledBy?: string;
  className?: string;
}) {
  const clamped = Math.min(Math.max(progress, 0), 1);
  const circumference = 62.83;

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      {...(labelledBy
        ? {
            role: "progressbar",
            "aria-labelledby": labelledBy,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.round(clamped * 100),
          }
        : { "aria-hidden": true })}
    >
      <circle
        r="10"
        cx="12"
        cy="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="opacity-25"
      />
      <circle
        r="10"
        cx="12"
        cy="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        transform="rotate(-90 12 12)"
        className="motion-loop"
        style={{
          transition: "stroke-dashoffset var(--transition-duration-move) var(--ease-standard)",
        }}
      />
    </svg>
  );
}
