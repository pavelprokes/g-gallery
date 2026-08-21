/**
 * Prints the exact table/field shape better-auth expects for the CURRENT
 * version and plugin set, straight from the library.
 *
 *   pnpm auth:tables
 *
 * The published @better-auth/cli lags the library (it generated a 1.4-era
 * schema against better-auth 1.7.1 and silently omitted Account.issuer), so
 * this is the reliable source when prisma/schema.prisma drifts.
 */
import "dotenv/config";
import { getAuthTables } from "better-auth/db";
import { auth } from "../src/lib/auth";

type Field = {
  type: string | string[];
  required?: boolean;
  unique?: boolean;
  fieldName?: string;
  defaultValue?: unknown;
  references?: { model: string; field: string; onDelete?: string };
};

const tables = getAuthTables(auth.options) as Record<
  string,
  { modelName: string; fields: Record<string, Field> }
>;

for (const [key, table] of Object.entries(tables)) {
  console.log(`\n${key}  ->  table "${table.modelName}"`);
  for (const [name, f] of Object.entries(table.fields)) {
    const bits = [
      Array.isArray(f.type) ? f.type.join("|") : f.type,
      f.required === false ? "optional" : "required",
      f.unique ? "unique" : "",
      f.references
        ? `-> ${f.references.model}.${f.references.field} (onDelete=${f.references.onDelete ?? "-"})`
        : "",
      f.fieldName && f.fieldName !== name ? `column=${f.fieldName}` : "",
      f.defaultValue !== undefined ? "hasDefault" : "",
    ].filter(Boolean);
    console.log(`   ${name.padEnd(24)} ${bits.join("  ")}`);
  }
}
