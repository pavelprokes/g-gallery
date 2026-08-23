import type { ButtonHTMLAttributes } from "react";

// The admin portal had the same "primary button" class string copy-pasted six
// times (and two more incompatible takes on "secondary"/"destructive") with no
// shared component. This is that component.
//
// The geometry (8px radius, 600 weight, 42px tall at `lg`, brown-on-white
// secondary, outline-that-fills danger) matches the admin portal on the
// photographer's main site — see svatebni-fotograf-cechy-2.0/components/Admin/ui.ts.
// `inline-flex` is what makes `min-h-*` actually center the label rather than
// just reserving height.
const BASE =
  "inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors";

const VARIANT_CLASSES = {
  primary:
    "border border-brand-primary bg-brand-primary text-white hover:border-brand-primary-dark hover:bg-brand-primary-dark",
  secondary:
    "border border-admin-border bg-white text-brand-ink hover:border-brand-primary hover:text-brand-primary dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800",
  // Outline at rest, filled on hover — a destructive action should look like a
  // warning before it looks like a button.
  destructive:
    "border border-admin-danger bg-transparent text-admin-danger hover:bg-admin-danger hover:text-white dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900 dark:hover:text-white",
  // Borderless, for a control that sits inside another control's chrome.
  ghost:
    "border border-transparent bg-transparent text-admin-muted hover:text-brand-primary dark:text-neutral-400 dark:hover:text-neutral-100",
} as const;

const SIZE_CLASSES = {
  sm: "gap-1.5 px-2.5 py-1 text-xs",
  md: "gap-2 px-3.5 py-2 text-sm",
  lg: "min-h-11 gap-2 px-5 text-sm",
} as const;

type ButtonVariant = keyof typeof VARIANT_CLASSES;
type ButtonSize = keyof typeof SIZE_CLASSES;

const DISABLED = "disabled:cursor-not-allowed disabled:opacity-55";

/**
 * The same look for an `<a>`. A link that navigates must stay a link — it has
 * to work with a middle click and open in a new tab — so it cannot be the
 * `Button` element above, but it has no business inventing its own styling.
 */
export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "lg") {
  return `${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={`${BASE} ${DISABLED} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
