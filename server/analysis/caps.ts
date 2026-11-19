// Per-account daily photo limit and a global daily spend cap, both counted
// from analysis_log so a shared link cannot run up the bill. "Today" starts
// at local midnight on the server.
import type { DatabaseSync } from "node:sqlite";
import { config } from "../config.ts";
import { db as defaultDb } from "../db.ts";

export type CapKind = "account_daily_photos" | "global_daily_spend";

export class CapError extends Error {
  readonly kind: CapKind;
  constructor(kind: CapKind, message: string) {
    super(message);
    this.name = "CapError";
    this.kind = kind;
  }
}

const TODAY = "datetime('now', 'localtime', 'start of day', 'utc')";

export function photosToday(accountId: number, database: DatabaseSync = defaultDb): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS n FROM analysis_log WHERE account_id = ? AND created_at >= ${TODAY}`)
    .get(accountId) as { n: number };
  return Number(row.n);
}

export function spendTodayUsd(database: DatabaseSync = defaultDb): number {
  const row = database
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM analysis_log WHERE created_at >= ${TODAY}`)
    .get() as { s: number };
  return Number(row.s);
}

export function checkCaps(
  accountId: number,
  database: DatabaseSync = defaultDb,
  limits = { dailyPhotoLimit: config.dailyPhotoLimit, dailySpendCapUsd: config.dailySpendCapUsd },
): void {
  if (photosToday(accountId, database) >= limits.dailyPhotoLimit) {
    throw new CapError("account_daily_photos", `account ${accountId} hit ${limits.dailyPhotoLimit} photos today`);
  }
  if (spendTodayUsd(database) >= limits.dailySpendCapUsd) {
    throw new CapError("global_daily_spend", `global spend cap of $${limits.dailySpendCapUsd} reached today`);
  }
}

export type LogRow = {
  account_id: number | null;
  meal_id?: number | null;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  ok: boolean;
  error?: string | null;
};

export function logAnalysis(row: LogRow, database: DatabaseSync = defaultDb): void {
  database
    .prepare(`INSERT INTO analysis_log (account_id, meal_id, model_id, input_tokens, output_tokens, cost_usd, ok, error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.account_id, row.meal_id ?? null, row.model_id, row.input_tokens, row.output_tokens,
      row.cost_usd, row.ok ? 1 : 0, row.error ?? null);
}
