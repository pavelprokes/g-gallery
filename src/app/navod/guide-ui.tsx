import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { CheckCircleIcon } from "@/components/ui/icons";

/**
 * The building blocks every section of the client guide (/navod) is made of —
 * kept in one place so the sections read the same and a style change is one
 * edit, the way the home page's sections share their classes.
 */

/** A control's glyph shown inline in a sentence, so the reader knows what to look for. */
export function InlineGlyph({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <span
      className="bg-brand-tint border-brand-border/70 text-brand-ink mx-0.5 inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full border px-1 align-middle dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children}
    </span>
  );
}

/** A numbered top-level section ("1. Výběr fotek k tisku"), anchored for the table of contents. */
export function GuideSection({
  id,
  heading,
  intro,
  children,
}: {
  id: string;
  heading: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-14 scroll-mt-6">
      <h2 id={id} className="text-brand-ink text-2xl font-semibold dark:text-neutral-100">
        {heading}
      </h2>
      {intro && <p className="mt-2 max-w-prose text-neutral-600 dark:text-neutral-400">{intro}</p>}
      {children}
    </section>
  );
}

export function SubHeading({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <>
      <h3 className="text-brand-ink mt-10 text-xl font-semibold dark:text-neutral-100">
        {children}
      </h3>
      {lead && (
        <p className="mt-2 max-w-prose text-sm text-neutral-600 dark:text-neutral-400">{lead}</p>
      )}
    </>
  );
}

export interface Step {
  title: string;
  body: ReactNode;
}

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-4 space-y-4">
      {steps.map(({ title, body }, index) => (
        <li key={title} className="flex gap-3">
          <span className="bg-brand-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white tabular-nums">
            {index + 1}
          </span>
          <div className="text-sm">
            <p className="text-brand-ink font-medium dark:text-neutral-100">{title}</p>
            <div className="mt-1 space-y-1 text-neutral-600 dark:text-neutral-400">{body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A tinted card holding a titled run of steps — one "way" of doing something. */
export function StepCard({ title, lead, steps }: { title: string; lead?: string; steps: Step[] }) {
  return (
    <Card className="bg-brand-tint dark:bg-neutral-900">
      <h3 className="text-brand-ink font-semibold dark:text-neutral-100">{title}</h3>
      {lead && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{lead}</p>}
      <StepList steps={steps} />
    </Card>
  );
}

/** Check-marked list; an item may lead with a bold title, as the home page's tips do. */
export function CheckList({
  items,
}: {
  items: (ReactNode | { title: string; body: ReactNode })[];
}) {
  return (
    <ul className="mt-4 space-y-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <CheckCircleIcon className="text-brand-primary mt-0.5 size-4 shrink-0" />
          <span>
            {isTitled(item) ? (
              <>
                <strong className="text-brand-ink font-medium dark:text-neutral-100">
                  {item.title}
                </strong>{" "}
                {item.body}
              </>
            ) : (
              item
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function isTitled(item: unknown): item is { title: string; body: ReactNode } {
  return typeof item === "object" && item !== null && "title" in item && "body" in item;
}

export function TermList({ terms }: { terms: { term: string; body: ReactNode }[] }) {
  return (
    <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
      {terms.map(({ term, body }) => (
        <div key={term} className="contents">
          <dt className="text-brand-ink font-medium dark:text-neutral-100">{term}</dt>
          <dd className="mb-2 text-neutral-600 sm:mb-0 dark:text-neutral-400">{body}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A short highlighted note — the one sentence of a subsection worth not missing. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="border-brand-primary/60 text-brand-ink mt-4 border-l-2 pl-3 text-sm dark:text-neutral-200">
      {children}
    </p>
  );
}
