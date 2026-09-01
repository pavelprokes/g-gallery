export function UploadProgressRing({
  done,
  total,
  className = "size-6",
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const progress = total > 0 ? done / total : 0;
  const circumference = 62.83;

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
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
        strokeDashoffset={circumference * (1 - progress)}
        transform="rotate(-90 12 12)"
        className="motion-loop"
        style={{
          transition: "stroke-dashoffset var(--transition-duration-move) var(--ease-standard)",
        }}
      />
    </svg>
  );
}
