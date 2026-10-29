"use client";

import { useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

// A row of buttons that pick one of a few options (length, pace, sound…):
// WAI-ARIA's radio group — one tab stop, the arrow keys move the choice
// (https://www.w3.org/WAI/ARIA/apg/patterns/radio/), which a row of plain
// `role="radio"` buttons does not do by itself.

export interface Choice<T> {
  value: T;
  label: string;
}

export function ChoiceGroup<T extends string | number | boolean>({
  label,
  choices,
  value,
  onChange,
  size = "md",
  className = "",
}: {
  /** What is being chosen — the group's accessible name. */
  label: string;
  choices: readonly Choice<NoInfer<T>>[];
  value: T;
  onChange(value: NoInfer<T>): void;
  size?: "sm" | "md";
  className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    choices.findIndex((c) => c.value === value),
  );
  const move = (event: KeyboardEvent, from: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? choices.length - 1
          : step === undefined
            ? null
            : (from + step + choices.length) % choices.length;
    if (to === null) return;
    event.preventDefault();
    onChange(choices[to]!.value);
    buttons.current[to]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={`flex flex-wrap gap-2 ${className}`}>
      {choices.map((choice, i) => (
        <Button
          key={String(choice.value)}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          role="radio"
          size={size}
          aria-checked={i === current}
          // One tab stop for the group: the chosen option.
          tabIndex={i === current ? 0 : -1}
          variant={i === current ? "primary" : "secondary"}
          onClick={() => onChange(choice.value)}
          onKeyDown={(e) => move(e, i)}
        >
          {choice.label}
        </Button>
      ))}
    </div>
  );
}
