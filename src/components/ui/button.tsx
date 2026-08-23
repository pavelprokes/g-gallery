import type { ButtonHTMLAttributes } from "react";

// The admin portal had the same "primary button" class string copy-pasted six
// times (and two more incompatible takes on "secondary"/"destructive") with no
// shared component. This is that component.
const VARIANT_CLASSES = {
  primary: "bg-brand-primary text-white hover:bg-brand-primary-dark",
  secondary:
    "border border-neutral-300 bg-white text-brand-ink hover:border-brand-primary hover:bg-brand-tint dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800",
  destructive:
    "border border-red-300 bg-white text-red-600 hover:bg-red-50 dark:border-red-900 dark:bg-neutral-900 dark:hover:bg-red-950/30",
} as const;

const SIZE_CLASSES = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
  lg: "px-4 py-2 text-sm",
} as const;

type ButtonVariant = keyof typeof VARIANT_CLASSES;
type ButtonSize = keyof typeof SIZE_CLASSES;

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
      className={`rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
