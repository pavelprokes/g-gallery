"use client";

import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { useScrollLock } from "@/lib/use-scroll-lock";

/**
 * What the guest had typed when they last dismissed the sheet with a tap on
 * the backdrop or Escape — kept for this page's lifetime, so a stray tap
 * beside the sheet does not cost them their name. Module state, not storage:
 * an unconfirmed draft is not something to remember past a reload.
 */
let nameDraft = "";

/** Exported for the colocated test. */
export function resetNameDraft() {
  nameDraft = "";
}

/**
 * The one place a guest is asked their name (docs/GUEST-GALLERIES.md §6): before
 * adding photos, and the first time they heart, react to or mark one for print.
 *
 * There used to be two dialogs for this with two different shapes — a centred
 * box with the buttons right-aligned, and a bottom sheet with the primary
 * button stretched — so the same question looked like a different product
 * depending on what you had tapped. This is the shell both now share; what the
 * buttons *do* stays with the caller, because the upload sheet's buttons have
 * to be file inputs (see src/components/guest-uploader.tsx).
 *
 * Docked to the bottom edge on a phone, where the thumb already is, and
 * centred on anything wider.
 */
export function NameSheet({
  title,
  hint,
  value,
  onChange,
  onSubmit,
  onDismiss,
  placeholder,
  children,
  inputRef: externalInputRef,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter in the field, or a `type="submit"` button among the children. */
  onSubmit: () => void;
  /** Escape or a tap on the dimmed backdrop. */
  onDismiss: () => void;
  placeholder: string;
  /** The actions, stacked: primary first. See {@link SHEET_PRIMARY}. */
  children: ReactNode;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const ownInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? ownInputRef;

  // An empty field picks up the draft a dismissal left behind. Once, on open:
  // clearing the field afterwards is the guest's own doing.
  const restored = useRef(false);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (!latest.current.value && nameDraft) latest.current.onChange(nameDraft);
  }, []);

  // Focus goes straight to the field. The sheet always opens from a tap, and
  // React flushes a discrete event's effects inside that event, so this still
  // counts as a user gesture on iOS — which is what brings the keyboard up
  // without a second tap into the field.
  return (
    <Sheet
      title={title}
      hint={hint}
      onSubmit={() => {
        nameDraft = "";
        onSubmit();
      }}
      onDismiss={() => {
        nameDraft = value;
        onDismiss();
      }}
      initialFocusRef={inputRef}
      field={(titleId) => (
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-labelledby={titleId}
          maxLength={60}
          placeholder={placeholder}
          // 16 px: anything smaller and iOS Safari zooms the page in on focus.
          className="focus:border-brand-primary focus:ring-brand-primary/20 dark:focus:border-brand-border dark:focus:ring-brand-border/20 duration-flip mt-4 min-h-12 w-full rounded-lg border bg-transparent px-3.5 text-base transition-colors outline-none focus:ring-3"
          autoComplete="given-name"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
      )}
    >
      {children}
    </Sheet>
  );
}

/**
 * The shell every guest-facing question shares: a dimmed backdrop, a sheet
 * docked to the bottom on a phone and centred on anything wider, a title, one
 * line of explanation, and the actions stacked under it.
 */
export function Sheet({
  title,
  hint,
  onSubmit,
  onDismiss,
  initialFocusRef,
  field,
  children,
}: {
  title: string;
  hint: string;
  onSubmit: () => void;
  onDismiss: () => void;
  /** Where focus lands on open; the first focusable control otherwise. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Rendered between the hint and the actions, given the title's id. */
  field?: (titleId: string) => ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const hintId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();

  useFocusTrap(containerRef, true, initialFocusRef);
  useScrollLock();

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      tabIndex={-1}
      className="animate-scrim-in fixed inset-0 z-60 flex items-end justify-center bg-black/45 outline-none sm:items-center sm:p-4"
      // On iOS the keyboard overlays the page instead of resizing it, so a
      // sheet docked to the bottom edge would sit underneath it. The visual
      // viewport reports how much of the screen the keyboard took.
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
      onClick={onDismiss}
      onKeyDown={(event) => {
        // Owns its own Escape rather than letting it bubble to a lightbox that
        // may be open underneath.
        if (event.key === "Escape") {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <form
        // No grabber: it promises a drag-to-dismiss this sheet does not have
        // (the backdrop and Escape dismiss it), so a guest dragging it got
        // nothing. `pt-5` takes the room it held.
        className="animate-sheet-rise w-full rounded-t-2xl bg-white px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-sm sm:rounded-xl sm:pt-5 sm:pb-5 dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h2 id={titleId} className="text-title font-semibold">
          {title}
        </h2>
        <p id={hintId} className="text-body text-brand-ink/70 dark:text-brand-tint/70 mt-1">
          {hint}
        </p>
        {field?.(titleId)}
        <div className="mt-4 flex flex-col gap-1">{children}</div>
      </form>
    </div>
  );
}

/**
 * The sheet's primary action. Also used on a `<label>` wrapping a file input,
 * hence `relative` (the input is stretched over it) and the `has-[]` focus
 * ring (the focus lands on the invisible input, not on the label).
 */
export const SHEET_PRIMARY =
  "bg-brand-primary hover:bg-brand-primary-dark duration-flip relative flex min-h-12 w-full cursor-pointer items-center justify-center rounded-lg px-4 text-base font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2";

/** The quiet way out — present, but plainly the lesser choice. */
export const SHEET_SECONDARY =
  "text-body text-brand-ink/70 dark:text-brand-tint/70 relative flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg px-4 font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2";
