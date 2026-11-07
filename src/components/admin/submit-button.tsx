"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** A form's submit button that says it is working: a copy can take a few seconds. */
export function SubmitButton({ children, working }: { children: string; working: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={pending ? "disabled:opacity-100!" : ""}>
      {pending && (
        <span
          aria-hidden
          className="motion-loop size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      )}
      {pending ? working : children}
    </Button>
  );
}
