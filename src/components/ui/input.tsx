import type {
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

// The form-control family for the admin portal, matching the one on the
// photographer's main site (svatebni-fotograf-cechy-2.0/components/Admin/ui.ts
// `fieldStyles`): one border color, one radius, one focus treatment across
// input/select/textarea. The larger, mobile-oriented guest-upload input
// (src/components/guest-uploader.tsx) is a deliberate exception for touch
// targets and stays separate.
//
// Two things worth knowing before editing the focus classes:
//   - Tailwind 4's default ring color is `currentColor`, so `focus:ring-3`
//     without an explicit `focus:ring-*` paints brown-on-brown.
//   - The `:focus-visible` outline in globals.css is unlayered, so it wins over
//     any `focus:outline-none` here. That is intentional: a pointer user gets
//     the soft ring, a keyboard user gets the ring and a hard outline.
const FIELD =
  "border-admin-border text-brand-ink placeholder:text-admin-placeholder focus:border-brand-primary focus:ring-admin-accent-soft disabled:bg-admin-surface-muted aria-invalid:border-admin-danger min-h-11 w-full rounded-lg border bg-white px-3 py-2 focus:ring-3 disabled:cursor-not-allowed dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={`${FIELD} min-h-28 resize-y leading-relaxed ${className}`} {...props} />
  );
}

/**
 * Native `<select>` with the browser's arrow replaced by our own, because the
 * default one cannot be recolored and reads as gray plastic next to these
 * fields. `appearance-none` plus a background chevron is the standard trade:
 * the control stays a real `<select>` (keyboard, mobile picker, form
 * semantics), only the arrow is ours.
 */
export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`${FIELD} appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2010%206%22%3E%3Cpath%20d%3D%22M0%200h10L5%206z%22%20fill%3D%22%236f5e55%22/%3E%3C/svg%3E')] bg-[length:10px_6px] bg-[position:right_0.875rem_center] bg-no-repeat pr-9 ${className}`}
      {...props}
    />
  );
}

/** The small muted caption above a field. */
export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`text-admin-muted mb-1.5 block text-sm font-semibold dark:text-neutral-400 ${className}`}
      {...props}
    />
  );
}

/** Explanatory text under a field — why it exists, or what a valid value looks like. */
export function Hint({ className = "", ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`text-admin-muted mt-1 text-sm dark:text-neutral-400 ${className}`} {...props} />
  );
}
