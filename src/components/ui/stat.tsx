/**
 * One number and what it counts. The label sits *above* the value, matching the
 * KPI tiles in the admin on the photographer's main site: scanning a row of
 * these, you read what each one is before you read the digits, not after.
 */
export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border-admin-border rounded-xl border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-admin-muted text-sm font-semibold dark:text-neutral-400">{label}</p>
      <p className="mt-2 text-3xl leading-none font-bold tabular-nums">{value}</p>
    </div>
  );
}
