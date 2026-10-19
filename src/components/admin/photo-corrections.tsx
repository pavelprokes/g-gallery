"use client";

import { useTransition } from "react";
import { setCorrectionResolved } from "@/app/admin/correction-actions";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";

// A photo's corrections under its admin tile (docs/CORRECTIONS.md): what the
// couple wrote, numbered like the spots they marked, each one ticked off here.

interface Comment {
  id: string;
  body: string;
  x: number | null;
  y: number | null;
  resolvedAt: Date | null;
  shareLinkId: string;
  shareLink: { label: string | null };
}

/**
 * Each comment's number as the couple sees it — counted per link, in order —
 * with the link's letter in front when more than one link wrote on the photo.
 */
function numberComments(comments: Comment[]) {
  const links = [...new Set(comments.map((comment) => comment.shareLinkId))];
  const counts = new Map<string, number>();
  return comments.map((comment) => {
    const n = (counts.get(comment.shareLinkId) ?? 0) + 1;
    counts.set(comment.shareLinkId, n);
    const letter =
      links.length > 1 ? String.fromCharCode(65 + links.indexOf(comment.shareLinkId)) : "";
    return { comment, label: `${letter}${n}` };
  });
}

export function PhotoCorrections({
  photo,
  comments,
}: {
  photo: {
    objectKey: string;
    thumbObjectKey: string | null;
    fileName: string;
    width: number | null;
    height: number | null;
  };
  comments: Comment[];
}) {
  const [pending, startTransition] = useTransition();
  const numbered = numberComments(comments);
  const manyLinks = new Set(comments.map((comment) => comment.shareLinkId)).size > 1;
  const spots = numbered.flatMap(({ comment, label }) =>
    comment.x !== null && comment.y !== null
      ? [{ id: comment.id, n: label, x: comment.x, y: comment.y, done: !!comment.resolvedAt }]
      : [],
  );
  return (
    <div className="space-y-1">
      {/* The whole photo at its own shape, so the spots land where the couple
          tapped — the square tile above crops it. */}
      {spots.length > 0 && photo.width && photo.height && (
        <div
          className="relative w-full overflow-hidden rounded"
          style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
        >
          <AdminPhotoImage
            objectKey={photo.objectKey}
            thumbObjectKey={photo.thumbObjectKey}
            alt={`Místa připomínek na ${photo.fileName}`}
            sizes="(max-width: 640px) 33vw, 200px"
          />
          {spots.map((spot) => (
            <span
              key={spot.id}
              aria-hidden
              className={`absolute flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white px-0.5 text-[10px] font-bold text-white shadow ${
                spot.done ? "bg-emerald-600" : "bg-brand-primary"
              }`}
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
            >
              {spot.n}
            </span>
          ))}
        </div>
      )}
      <ol className="space-y-1" aria-label={`Připomínky klienta k ${photo.fileName}`}>
        {numbered.map(({ comment, label }) => {
          const done = comment.resolvedAt !== null;
          return (
            <li
              key={comment.id}
              className={`text-caption rounded border px-2 py-1 ${
                done
                  ? "border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300"
                  : "border-brand-primary/40 text-brand-ink dark:text-neutral-100"
              }`}
            >
              <p className="break-words whitespace-pre-wrap">
                <span className="font-semibold">✎ {label}</span>
                {manyLinks && (
                  <span className="text-admin-muted">
                    {" "}
                    ({comment.shareLink.label ?? "odkaz bez popisu"})
                  </span>
                )}{" "}
                {comment.body}
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => setCorrectionResolved(comment.id, !done))}
                className="mt-0.5 min-h-8 font-semibold underline disabled:opacity-50"
              >
                {done ? "Vyřízeno ✓ · vrátit" : "Označit vyřízené"}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
