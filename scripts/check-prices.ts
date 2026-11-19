// Validates data/prices.json against data/prices.schema.json and a few
// sanity rules, then prints a summary. Run with: npx tsx scripts/check-prices.ts
// Exits with code 1 when there are errors. Warnings do not fail the run.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type PriceRow = {
  id: string;
  name: string;
  aliases: string[];
  unit: string;
  price_per_unit_cad: number;
  typical_pack?: string;
  source: string;
  checked_on: string;
};

export type CheckResult = {
  errors: string[];
  warnings: string[];
  count: number;
  byUnit: Record<string, number>;
  bySource: Record<string, number>;
  estimates: number;
};

// Highest plausible price per one unit. Anything above is flagged as an error,
// since it almost always means a pack price was entered instead of a unit price.
export const MAX_PER_UNIT: Record<string, number> = {
  g: 0.1,
  ml: 0.1,
  each: 10,
  slice: 2,
  tbsp: 2,
  cup: 10,
};

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function loadSchema(): any {
  return JSON.parse(readFileSync(resolve(root, "data/prices.schema.json"), "utf8"));
}

export function loadPrices(): unknown {
  return JSON.parse(readFileSync(resolve(root, "data/prices.json"), "utf8"));
}

// Checks one value against the small subset of JSON Schema the price schema uses:
// type, required, properties, enum, items, format date.
function checkAgainstSchema(value: any, schema: any, path: string, errors: string[]) {
  const t = schema.type;
  if (t === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required field "${key}"`);
    }
    const props = schema.properties ?? {};
    for (const key of Object.keys(value)) {
      if (!(key in props)) errors.push(`${path}: unknown field "${key}"`);
      else checkAgainstSchema(value[key], props[key], `${path}.${key}`, errors);
    }
    return;
  }
  if (t === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    value.forEach((v, i) => checkAgainstSchema(v, schema.items ?? {}, `${path}[${i}]`, errors));
    return;
  }
  if (t === "string") {
    if (typeof value !== "string") {
      errors.push(`${path}: expected string`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path}: "${value}" is not one of ${schema.enum.join(", ")}`);
    }
    if (schema.format === "date" && (!DATE.test(value) || isNaN(Date.parse(value)))) {
      errors.push(`${path}: "${value}" is not a YYYY-MM-DD date`);
    }
    return;
  }
  if (t === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path}: expected number`);
  }
}

export function checkPrices(data: unknown): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byUnit: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let estimates = 0;

  if (!Array.isArray(data)) {
    return { errors: ["prices.json: top level must be an array"], warnings, count: 0, byUnit, bySource, estimates };
  }

  const schema = loadSchema();
  const ids = new Set<string>();
  const aliasOwner = new Map<string, string>();

  data.forEach((row: any, i: number) => {
    const where = `row ${i} (${row?.id ?? "no id"})`;
    checkAgainstSchema(row, schema, where, errors);
    if (typeof row !== "object" || row === null) return;

    if (typeof row.id === "string") {
      if (!SNAKE.test(row.id)) errors.push(`${where}: id is not snake_case`);
      if (ids.has(row.id)) errors.push(`${where}: duplicate id`);
      ids.add(row.id);
    }

    const p = row.price_per_unit_cad;
    if (typeof p === "number") {
      if (!(p > 0)) errors.push(`${where}: price must be positive, got ${p}`);
      const max = MAX_PER_UNIT[row.unit];
      if (max !== undefined && p > max) {
        errors.push(`${where}: $${p} per ${row.unit} is over the plausible limit of $${max}`);
      }
    }

    if (Array.isArray(row.aliases)) {
      if (row.aliases.length === 0) warnings.push(`${where}: no aliases`);
      for (const a of row.aliases) {
        if (typeof a !== "string") continue;
        const key = a.trim().toLowerCase();
        const owner = aliasOwner.get(key);
        if (owner && owner !== row.id) warnings.push(`alias "${a}" is on both ${owner} and ${row.id}`);
        else aliasOwner.set(key, row.id);
      }
    }

    if (typeof row.unit === "string") byUnit[row.unit] = (byUnit[row.unit] ?? 0) + 1;
    if (typeof row.source === "string") {
      bySource[row.source] = (bySource[row.source] ?? 0) + 1;
      if (row.source === "estimate") estimates++;
    }
  });

  return { errors, warnings, count: data.length, byUnit, bySource, estimates };
}

function main() {
  const r = checkPrices(loadPrices());
  console.log(`prices.json: ${r.count} items, ${r.count - r.estimates} sourced, ${r.estimates} estimates`);
  console.log("by unit:", Object.entries(r.byUnit).map(([k, v]) => `${k} ${v}`).join(", "));
  console.log("by source:");
  for (const [k, v] of Object.entries(r.bySource).sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
  for (const w of r.warnings) console.log(`warning: ${w}`);
  for (const e of r.errors) console.log(`error: ${e}`);
  console.log(r.errors.length ? `FAILED with ${r.errors.length} errors` : "OK");
  if (r.errors.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
