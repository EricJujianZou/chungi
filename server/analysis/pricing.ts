// Prices the model's ingredient lines against the grocery table in
// data/prices.json. The model never prices anything itself.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IngredientLine } from "../types.ts";

export type Unit = "g" | "ml" | "each" | "slice" | "cup" | "tbsp";

export type PriceRow = {
  id: string;
  name: string;
  aliases: string[];
  unit: Unit;
  price_per_unit_cad: number;
  typical_pack?: string;
  source: string;
  checked_on: string;
};

export type ModelIngredient = { name: string; quantity: number; unit: string };

// Flat price for anything the table cannot match. The pet says "roughly".
export const UNMATCHED_ESTIMATE_CAD = 0.75;

// Used only when data/prices.json is empty or has no row for an item.
// Rough Waterloo grocery prices, Oct 2026, from memory of typical flyer
// prices. Owner C's table replaces these as rows land.
const FB = "built-in fallback, rough Waterloo prices";
const fb = (id: string, name: string, aliases: string[], unit: Unit, price: number, pack: string): PriceRow =>
  ({ id, name, aliases, unit, price_per_unit_cad: price, typical_pack: pack, source: FB, checked_on: "2026-10-07" });

export const FALLBACK_TABLE: PriceRow[] = [
  fb("egg", "egg", ["eggs", "large egg"], "each", 0.38, "dozen large $4.49"),
  fb("white_rice", "white rice", ["rice", "jasmine rice", "basmati rice", "long grain rice"], "g", 0.0044, "2 kg bag $8.79"),
  fb("spaghetti", "spaghetti", ["pasta", "penne", "noodles", "linguine", "fusilli", "macaroni"], "g", 0.0045, "900 g box $3.99"),
  fb("bread_white", "white bread", ["bread", "sandwich bread", "toast", "whole wheat bread", "sourdough"], "slice", 0.15, "675 g loaf, ~20 slices $2.99"),
  fb("canned_tuna", "canned tuna", ["tuna", "flaked tuna", "chunk light tuna"], "g", 0.0105, "170 g can $1.79"),
  fb("chicken_breast", "chicken breast", ["chicken", "chicken thigh", "boneless chicken"], "g", 0.0154, "1 kg pack $15.40"),
  fb("ground_beef", "ground beef", ["beef", "minced beef", "lean ground beef", "mince"], "g", 0.0132, "454 g $5.99"),
  fb("onion", "onion", ["yellow onion", "red onion", "white onion"], "g", 0.0033, "3 lb bag $4.49"),
  fb("garlic", "garlic", ["garlic clove", "minced garlic"], "g", 0.012, "3 bulbs $1.99"),
  fb("carrot", "carrot", ["carrots"], "g", 0.0029, "2 lb bag $2.69"),
  fb("frozen_peas", "frozen peas", ["peas", "green peas", "mixed vegetables", "frozen vegetables"], "g", 0.0044, "750 g bag $3.29"),
  fb("tomato", "tomato", ["roma tomato", "cherry tomato"], "g", 0.0066, "$2.99/lb"),
  fb("canned_tomato", "canned tomatoes", ["tomato sauce", "pasta sauce", "marinara", "crushed tomato", "diced tomato", "passata"], "ml", 0.0045, "680 ml jar $2.99"),
  fb("lettuce", "lettuce", ["romaine", "greens", "salad greens", "spring mix", "spinach", "mixed greens"], "g", 0.0110, "312 g clamshell $3.49"),
  fb("cheddar", "cheddar cheese", ["cheese", "shredded cheese", "mozzarella", "parmesan"], "g", 0.0185, "400 g block $7.39"),
  fb("butter", "butter", ["salted butter"], "g", 0.0127, "454 g $5.79"),
  fb("milk", "milk", ["2% milk", "whole milk"], "ml", 0.0016, "4 L bag $6.39"),
  fb("vegetable_oil", "vegetable oil", ["oil", "canola oil", "olive oil", "cooking oil", "sesame oil"], "ml", 0.0055, "1.42 L $7.79"),
  fb("soy_sauce", "soy sauce", ["light soy sauce", "dark soy sauce"], "ml", 0.0065, "500 ml $3.29"),
  fb("mayonnaise", "mayonnaise", ["mayo"], "ml", 0.0095, "890 ml $8.49"),
  fb("potato", "potato", ["potatoes", "russet potato"], "g", 0.0022, "10 lb bag $9.99"),
  fb("bell_pepper", "bell pepper", ["red pepper", "green pepper", "pepper"], "g", 0.0088, "$3.99/lb"),
  fb("broccoli", "broccoli", ["broccoli florets"], "g", 0.0066, "$2.99/lb"),
  fb("green_onion", "green onion", ["scallion", "spring onion"], "each", 0.25, "bunch of 6 $1.49"),
  fb("banana", "banana", ["bananas"], "each", 0.30, "$0.79/lb"),
  fb("tofu", "tofu", ["firm tofu", "extra firm tofu"], "g", 0.0077, "350 g $2.69"),
];

// Words that describe preparation or freshness, not the grocery item.
const STRIP_WORDS = new Set([
  "fresh", "chopped", "cooked", "diced", "sliced", "minced", "grated", "shredded", "boiled",
  "fried", "steamed", "roasted", "grilled", "baked", "toasted", "raw", "frozen", "dried",
  "large", "small", "medium", "whole", "ripe", "leftover", "homemade", "organic", "plain",
  "finely", "thinly", "lightly", "some", "a", "of", "the", "and", "piece", "pieces",
]);

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("ches") || word.endsWith("shes")) return word.slice(0, -2);
  if (word.endsWith("ss") || word.endsWith("us")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

// Lowercase, drop punctuation and preparation words, crude singular.
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9% ]+/g, " ")
    .split(/\s+/)
    .filter(w => w && !STRIP_WORDS.has(w))
    .map(singular)
    .join(" ");
}

type Index = { exact: Map<string, PriceRow>; rows: PriceRow[] };

function buildIndex(rows: PriceRow[]): Index {
  const exact = new Map<string, PriceRow>();
  for (const r of rows) {
    for (const n of [r.name, r.id.replace(/_/g, " "), ...r.aliases]) {
      const key = normaliseName(n);
      if (key && !exact.has(key)) exact.set(key, r);
    }
  }
  return { exact, rows };
}

function lookup(index: Index, name: string): PriceRow | undefined {
  const key = normaliseName(name);
  if (!key) return undefined;
  const hit = index.exact.get(key);
  if (hit) return hit;
  // Try dropping leading words: "jasmine white rice" -> "white rice" -> "rice".
  const words = key.split(" ");
  for (let i = 1; i < words.length; i++) {
    const tail = index.exact.get(words.slice(i).join(" "));
    if (tail) return tail;
  }
  return undefined;
}

// Grams per cup by ingredient class. Everything else uses DEFAULT_G_PER_CUP.
const G_PER_CUP: Array<[RegExp, number]> = [
  [/rice|quinoa|couscous/, 185],
  [/flour/, 125],
  [/sugar/, 200],
  [/oat/, 90],
  [/pasta|spaghetti|penne|macaroni|noodle/, 100],
  [/cheese|cheddar|mozzarella|parmesan/, 113],
  [/lettuce|greens|spinach|romaine|spring mix/, 30],
  [/pea|corn|vegetable|bean/, 145],
  [/broccoli|carrot|pepper|onion|tomato|potato/, 130],
  [/butter/, 227],
  [/oil/, 218],
  [/tuna|chicken|beef|pork|tofu/, 140],
];
const DEFAULT_G_PER_CUP = 150;
export const ML_PER_CUP = 240;
export const ML_PER_TBSP = 15;
const TBSP_PER_CUP = 16;

// Grams per one "each" or "slice", for when the table is in grams.
const G_PER_EACH: Array<[RegExp, number]> = [
  [/egg/, 50],
  [/onion/, 150],
  [/garlic/, 5],
  [/tomato/, 120],
  [/potato/, 200],
  [/carrot/, 70],
  [/pepper/, 150],
  [/banana/, 120],
  [/chicken/, 175],
  [/bread|toast/, 30],
  [/cheese|cheddar/, 20],
];
const DEFAULT_G_PER_EACH = 100;

function classValue(table: Array<[RegExp, number]>, name: string, fallback: number): number {
  for (const [re, v] of table) if (re.test(name)) return v;
  return fallback;
}

// Converts quantity from one unit into the table row's unit. Returns null
// when there is no sensible conversion. Liquids treat 1 ml as about 1 g.
export function convertQuantity(quantity: number, from: string, to: Unit, ingredientName: string): number | null {
  const n = ingredientName.toLowerCase();
  if (from === to) return quantity;
  const gPerCup = classValue(G_PER_CUP, n, DEFAULT_G_PER_CUP);
  const gPerEach = classValue(G_PER_EACH, n, DEFAULT_G_PER_EACH);

  // Step 1: express the amount in grams (or ml, treated as grams).
  let grams: number;
  switch (from) {
    case "g": grams = quantity; break;
    case "ml": grams = quantity; break;
    case "cup": grams = to === "ml" ? quantity * ML_PER_CUP : quantity * gPerCup; break;
    case "tbsp": grams = to === "ml" ? quantity * ML_PER_TBSP : (quantity * gPerCup) / TBSP_PER_CUP; break;
    case "each": case "slice": grams = quantity * gPerEach; break;
    default: return null;
  }
  // Step 2: express grams in the target unit.
  switch (to) {
    case "g": case "ml": return grams;
    case "cup": return from === "ml" ? grams / ML_PER_CUP : grams / gPerCup;
    case "tbsp": return from === "ml" ? grams / ML_PER_TBSP : (grams / gPerCup) * TBSP_PER_CUP;
    case "each": case "slice": return grams / gPerEach;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const PRICES_PATH = join(here, "..", "..", "data", "prices.json");

let cache: { table: Index; fallback: Index } | null = null;

export function loadPriceTable(path = PRICES_PATH): PriceRow[] {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data) ? (data as PriceRow[]) : [];
  } catch {
    return [];
  }
}

function indexes(): { table: Index; fallback: Index } {
  if (!cache) cache = { table: buildIndex(loadPriceTable()), fallback: buildIndex(FALLBACK_TABLE) };
  return cache;
}

// For tests and for picking up a new prices.json without a restart.
export function resetPriceCache(rows?: PriceRow[]): void {
  cache = rows ? { table: buildIndex(rows), fallback: buildIndex(FALLBACK_TABLE) } : null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function priceIngredients(items: ModelIngredient[]): { lines: IngredientLine[]; total: number } {
  const { table, fallback } = indexes();
  const lines: IngredientLine[] = items.map(item => {
    const row = lookup(table, item.name) ?? lookup(fallback, item.name);
    const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
    if (row) {
      const converted = convertQuantity(qty, item.unit, row.unit, item.name);
      if (converted !== null) {
        return {
          name: item.name, quantity: qty, unit: item.unit,
          price_cad: round2(converted * row.price_per_unit_cad),
          matched_id: row.id, estimated: false,
        };
      }
    }
    return { name: item.name, quantity: qty, unit: item.unit, price_cad: UNMATCHED_ESTIMATE_CAD, estimated: true };
  });
  const total = round2(lines.reduce((s, l) => s + l.price_cad, 0));
  return { lines, total };
}
