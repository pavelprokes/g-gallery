"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet, SHEET_PRIMARY, SHEET_SECONDARY } from "@/components/name-sheet";
import { PencilIcon } from "@/components/ui/icons";
import type { Correction, EnterResult } from "@/components/corrections/use-corrections";

// The guest side of the corrections mode (docs/CORRECTIONS.md): the PIN sheet,
// the bar that says the mode is on, the panel beside the photo in the
// lightbox, and the numbered spots on the photo.

export function CorrectionsPinSheet({
  onEnter,
  onDismiss,
}: {
  onEnter: (pin: string) => Promise<EnterResult>;
  onDismiss: () => void;
}) {
  const t = useTranslations("corrections");
  const inputRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || pin.length !== 6) return;
    setBusy(true);
    const result = await onEnter(pin);
    setBusy(false);
    if (result.ok) return;
    setPin("");
    inputRef.current?.focus();
    setError(
      result.reason === "wrong_pin"
        ? t("pinWrong")
        : result.reason === "locked"
          ? t("pinLocked", {
              minutes: Math.max(1, Math.ceil((result.until.getTime() - Date.now()) / 60_000)),
            })
          : t("error"),
    );
  }

  return (
    <Sheet
      title={t("pinTitle")}
      hint={t("pinHint")}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
      initialFocusRef={inputRef}
      field={(titleId) => (
        <div className="mt-4">
          <input
            ref={inputRef}
            aria-labelledby={titleId}
            value={pin}
            onChange={(event) => {
              setError(null);
              setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            // A numeric keypad on a phone, and the PIN from a message offered
            // above the keyboard where the platform does that.
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="••••••"
            className="border-brand-border focus:border-brand-primary w-full rounded-lg border bg-white px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em] tabular-nums outline-none dark:bg-neutral-800"
          />
          {error && (
            <p role="alert" className="text-body mt-2 text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    >
      <button
        type="submit"
        disabled={busy || pin.length !== 6}
        className={`${SHEET_PRIMARY} disabled:opacity-50`}
      >
        {t("pinSubmit")}
      </button>
      <button type="button" onClick={onDismiss} className={SHEET_SECONDARY}>
        {t("cancel")}
      </button>
    </Sheet>
  );
}

/** Says the mode is on, how much is in it, and how to leave. */
export function CorrectionsBar({ photoCount, onExit }: { photoCount: number; onExit: () => void }) {
  const t = useTranslations("corrections");
  return (
    <div className="pointer-events-none sticky top-2 z-30 flex h-0 items-start justify-center px-3">
      <div
        role="status"
        className="text-body pointer-events-auto flex min-h-11 max-w-md items-center gap-3 rounded-[22px] bg-black/70 py-1.5 pr-1.5 pl-4 text-white pointer-fine:backdrop-blur-md"
      >
        <PencilIcon className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium">{t("barTitle")}</span>
          <span className="text-white/70"> · {t("barCount", { count: photoCount })}</span>
        </span>
        <button
          type="button"
          onClick={onExit}
          className="min-h-9 rounded-full bg-white/15 px-3 font-medium hover:bg-white/25"
        >
          {t("exit")}
        </button>
      </div>
    </div>
  );
}

/** The mode ended under the viewer — the key expired or the PIN was changed. */
export function CorrectionsExpired({ onReenter }: { onReenter: () => void }) {
  const t = useTranslations("corrections");
  return (
    <div className="pointer-events-none sticky top-2 z-30 flex h-0 items-start justify-center px-3">
      <div
        role="status"
        className="text-body pointer-events-auto flex min-h-11 max-w-md items-center gap-3 rounded-[22px] bg-black/70 py-1.5 pr-1.5 pl-4 text-white"
      >
        <span>{t("expired")}</span>
        <button
          type="button"
          onClick={onReenter}
          className="min-h-9 shrink-0 rounded-full bg-white/15 px-3 font-medium hover:bg-white/25"
        >
          {t("pinSubmit")}
        </button>
      </div>
    </div>
  );
}

/** A tile's count of corrections, shown while the mode is on. */
export function CorrectionBadge({ count }: { count: number }) {
  const t = useTranslations("corrections");
  return (
    // Top centre: the corners hold the checkbox, the printer and the heart.
    <span className="bg-brand-primary pointer-events-none absolute top-2 left-1/2 flex h-6 min-w-6 -translate-x-1/2 items-center justify-center gap-0.5 rounded-full px-1.5 text-xs font-semibold text-white shadow">
      <PencilIcon className="h-3 w-3" />
      {count}
      <span className="sr-only">{t("badge", { count })}</span>
    </span>
  );
}

/**
 * The photo's numbered spots, laid over the part of the frame the photo
 * actually fills (it is `object-contain`), inside the zoomed frame so they
 * follow a pinch. While `placing`, a tap marks a new spot instead of reaching
 * the lightbox's own gestures.
 */
export function CorrectionMarkers({
  aspect,
  comments,
  draft,
  placing,
  onPlace,
}: {
  aspect: number;
  comments: Correction[];
  draft: { x: number; y: number } | null;
  placing: boolean;
  onPlace: (point: { x: number; y: number }) => void;
}) {
  const t = useTranslations("corrections");
  const boxRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const parent = boxRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrame({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // The contained photo's box within the frame.
  const fit = frame
    ? frame.width / frame.height > aspect
      ? { width: frame.height * aspect, height: frame.height }
      : { width: frame.width, height: frame.width / aspect }
    : null;
  const spots = comments.flatMap((comment, index) =>
    comment.x !== null && comment.y !== null
      ? [{ key: comment.id, n: index + 1, x: comment.x, y: comment.y, done: !!comment.resolvedAt }]
      : [],
  );

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      {fit && (
        <div
          className={`relative ${placing ? "pointer-events-auto cursor-crosshair" : ""}`}
          style={{ width: fit.width, height: fit.height }}
          onPointerDown={placing ? stop : undefined}
          onPointerUp={placing ? stop : undefined}
          onClick={
            placing
              ? (event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  onPlace({
                    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
                    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
                  });
                }
              : undefined
          }
          aria-label={placing ? t("placeHint") : undefined}
        >
          {placing && <span className="absolute inset-0 ring-2 ring-white/70 ring-inset" />}
          {spots.map((spot) => (
            <Spot key={spot.key} x={spot.x} y={spot.y} done={spot.done}>
              {spot.n}
            </Spot>
          ))}
          {draft && (
            <Spot x={draft.x} y={draft.y} done={false} draft>
              +
            </Spot>
          )}
        </div>
      )}
    </div>
  );
}

function Spot({
  x,
  y,
  done,
  draft = false,
  children,
}: {
  x: number;
  y: number;
  done: boolean;
  draft?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={`absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-[0_0_0_2px_rgba(0,0,0,0.35)] ${
        done ? "bg-emerald-600" : draft ? "bg-brand-primary animate-pulse" : "bg-brand-primary"
      }`}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
    >
      {children}
    </span>
  );
}

/**
 * The corrections on the photo in the lightbox, and the form to add one. A
 * side panel on a desktop, a sheet over the lower part of the screen on a
 * phone — the lightbox makes room for it either way.
 */
export function CorrectionsPanel({
  fileName,
  comments,
  placing,
  canMarkSpot,
  draft,
  onPlacingChange,
  onClearDraft,
  onCreate,
  onUpdate,
  onRemove,
}: {
  fileName: string;
  comments: Correction[];
  placing: boolean;
  canMarkSpot: boolean;
  draft: { x: number; y: number } | null;
  onPlacingChange: (placing: boolean) => void;
  onClearDraft: () => void;
  onCreate: (body: string) => Promise<boolean>;
  onUpdate: (id: string, body: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const t = useTranslations("corrections");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const ok = await onCreate(text);
    setBusy(false);
    if (ok) setBody("");
    else setError(t("error"));
  }

  return (
    <aside
      aria-label={t("panelTitle")}
      onClick={(event) => event.stopPropagation()}
      className="fixed inset-x-0 bottom-0 z-10 flex max-h-[45dvh] flex-col rounded-t-2xl bg-white text-neutral-900 shadow-2xl md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:max-h-none md:w-96 md:rounded-none dark:bg-neutral-900 dark:text-neutral-100"
    >
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-6">
        <h2 className="text-title font-semibold">{t("panelTitle")}</h2>
        <p className="text-caption truncate text-neutral-500">{fileName}</p>

        {comments.length === 0 ? (
          <p className="text-body mt-3 text-neutral-500">{t("empty")}</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {comments.map((comment, index) => (
              <CommentItem
                key={comment.id}
                n={index + 1}
                comment={comment}
                onUpdate={onUpdate}
                onRemove={onRemove}
              />
            ))}
          </ol>
        )}

        <form
          className="mt-4 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label className="text-body block font-medium">
            {t("newLabel")}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={t("placeholder")}
              // 16 px: iOS zooms the page into anything smaller.
              className="border-brand-border focus:border-brand-primary mt-1 block w-full resize-y rounded-lg border bg-white px-3 py-2 text-base font-normal outline-none dark:bg-neutral-800"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {!canMarkSpot ? null : draft ? (
              <button
                type="button"
                onClick={onClearDraft}
                className="text-body min-h-11 rounded-full border px-3 font-medium"
              >
                {t("removeSpot")}
              </button>
            ) : (
              <button
                type="button"
                aria-pressed={placing}
                onClick={() => onPlacingChange(!placing)}
                className={`text-body min-h-11 rounded-full border px-3 font-medium ${
                  placing ? "border-brand-primary bg-brand-tint text-brand-ink" : ""
                }`}
              >
                {placing ? t("placing") : t("markSpot")}
              </button>
            )}
            <button
              type="submit"
              disabled={busy || !body.trim()}
              className="bg-brand-primary hover:bg-brand-primary-dark text-body ml-auto min-h-11 rounded-full px-4 font-semibold text-white disabled:opacity-50"
            >
              {t("add")}
            </button>
          </div>
          {placing && <p className="text-caption text-neutral-500">{t("placeHint")}</p>}
          {error && (
            <p role="alert" className="text-body text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </form>
        <p className="text-caption mt-4 text-neutral-500">{t("privacy")}</p>
      </div>
    </aside>
  );
}

function CommentItem({
  n,
  comment,
  onUpdate,
  onRemove,
}: {
  n: number;
  comment: Correction;
  onUpdate: (id: string, body: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const t = useTranslations("corrections");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const resolved = comment.resolvedAt !== null;

  async function run(action: () => Promise<boolean>, after: () => void) {
    setBusy(true);
    setError(false);
    const ok = await action();
    setBusy(false);
    if (ok) after();
    else setError(true);
  }

  return (
    <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex items-start gap-2">
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
            resolved ? "bg-emerald-600" : "bg-brand-primary"
          }`}
        >
          {n}
        </span>
        {editing ? (
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={1000}
            rows={3}
            aria-label={t("editLabel", { n })}
            className="border-brand-border block w-full rounded-lg border bg-white px-2 py-1 text-base dark:bg-neutral-800"
          />
        ) : (
          <p className="text-body min-w-0 flex-1 break-words whitespace-pre-wrap">{comment.body}</p>
        )}
      </div>
      {resolved ? (
        <p className="text-caption mt-2 font-semibold text-emerald-700 dark:text-emerald-400">
          {t("resolved")}
        </p>
      ) : editing ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() =>
              void run(
                () => onUpdate(comment.id, text.trim()),
                () => setEditing(false),
              )
            }
            className="bg-brand-primary text-body min-h-11 rounded-full px-4 font-semibold text-white disabled:opacity-50"
          >
            {t("save")}
          </button>
          <button
            type="button"
            onClick={() => {
              setText(comment.body);
              setEditing(false);
            }}
            className="text-body min-h-11 rounded-full px-3"
          >
            {t("cancel")}
          </button>
        </div>
      ) : confirming ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-body">{t("confirmDelete")}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => onRemove(comment.id),
                () => setConfirming(false),
              )
            }
            className="text-body min-h-11 rounded-full bg-red-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {t("delete")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-body min-h-11 rounded-full px-3"
          >
            {t("cancel")}
          </button>
        </div>
      ) : (
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-body text-brand-primary-dark dark:text-brand-tint min-h-11 rounded-full px-3 font-medium hover:underline"
          >
            {t("edit")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-body min-h-11 rounded-full px-3 font-medium text-red-700 hover:underline dark:text-red-400"
          >
            {t("delete")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-caption mt-1 text-red-700 dark:text-red-400">
          {t("error")}
        </p>
      )}
    </li>
  );
}
