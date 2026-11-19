// Scripted pet lines from data/copy.json (draft copy).
// line(key) returns one variant at random.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, "..", "data", "copy.json"), "utf8")) as Record<string, unknown>;

export const COPY: Record<string, string[]> = {};
for (const [k, v] of Object.entries(raw)) {
  if (k.startsWith("_")) continue;
  if (!Array.isArray(v) || v.length < 1 || v.length > 3 || !v.every(s => typeof s === "string")) {
    throw new Error(`data/copy.json: key ${k} must be an array of 1 to 3 strings`);
  }
  COPY[k] = v as string[];
}

export type CopyKey =
  | "first_open" | "name_prompt" | "checkin_question" | "checkin_cooking" | "checkin_ordering"
  | "timer_start" | "timer_running" | "photo_waiting" | "fallback_cannot_name" | "cap_reached"
  | "growth_stage_up_1" | "growth_stage_up_2" | "growth_stage_up_3"
  | "growth_stage_up_4" | "growth_stage_up_5" | "growth_stage_up_6"
  | "cosmetic_bought" | "share_prompt" | "recovery_key_offer" | "comparison_question";

export function line(key: CopyKey): string {
  const variants = COPY[key];
  if (!variants) throw new Error(`no copy for ${key}`);
  return variants[Math.floor(Math.random() * variants.length)];
}

// Growth line for a stage from 1 to 6.
export function growthLine(stage: number): string {
  const s = Math.min(6, Math.max(1, Math.round(stage)));
  return line(`growth_stage_up_${s}` as CopyKey);
}

// Pet naming defaults. Keys start with _ so line() ignores them.
export const NAME_DEFAULT: string = typeof raw._name_default === "string" ? raw._name_default : "Chungi";
export const NAME_SUGGESTIONS: string[] = Array.isArray(raw._name_suggestions) ? (raw._name_suggestions as string[]) : [];
