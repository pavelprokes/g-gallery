import type { InputHTMLAttributes } from "react";

// Unifies the owner-density input used across every admin form. The larger,
// mobile-oriented guest-upload input (src/components/guest-uploader.tsx) is a
// deliberate exception for touch targets and stays separate.
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900 ${className}`}
      {...props}
    />
  );
}
