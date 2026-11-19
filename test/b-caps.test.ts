import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// db.ts opens the database on import, so point it at a temp dir first.
process.env.CHUNGI_VAR = mkdtempSync(join(tmpdir(), "chungi-b-caps-"));
process.env.CHUNGI_DB = join(process.env.CHUNGI_VAR, "test.sqlite");

let caps: typeof import("../server/analysis/caps.ts");
let db: typeof import("../server/db.ts")["db"];

beforeAll(async () => {
  caps = await import("../server/analysis/caps.ts");
  db = (await import("../server/db.ts")).db;
});

beforeEach(() => {
  db.exec("DELETE FROM analysis_log");
});

const log = (account: number, cost: number, when = "datetime('now')") =>
  db.exec(`INSERT INTO analysis_log (account_id, model_id, input_tokens, output_tokens, cost_usd, ok, created_at)
           VALUES (${account}, 'm', 0, 0, ${cost}, 1, ${when})`);

describe("checkCaps", () => {
  const limits = { dailyPhotoLimit: 3, dailySpendCapUsd: 1 };

  it("passes under both limits", () => {
    log(1, 0.01); log(1, 0.01);
    expect(() => caps.checkCaps(1, db, limits)).not.toThrow();
  });

  it("throws a CapError for the account photo limit", () => {
    log(1, 0.01); log(1, 0.01); log(1, 0.01);
    try {
      caps.checkCaps(1, db, limits);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(caps.CapError);
      expect((e as InstanceType<typeof caps.CapError>).kind).toBe("account_daily_photos");
    }
    // Another account is unaffected by account 1's count.
    expect(() => caps.checkCaps(2, db, limits)).not.toThrow();
  });

  it("throws a CapError for the global spend cap across accounts", () => {
    log(1, 0.6); log(2, 0.5);
    expect(() => caps.checkCaps(3, db, limits)).toThrowError(caps.CapError);
    try { caps.checkCaps(3, db, limits); } catch (e) {
      expect((e as InstanceType<typeof caps.CapError>).kind).toBe("global_daily_spend");
    }
  });

  it("ignores rows from before today", () => {
    log(1, 5, "datetime('now', '-2 days')");
    log(1, 0, "datetime('now', '-2 days')");
    log(1, 0, "datetime('now', '-2 days')");
    expect(caps.photosToday(1, db)).toBe(0);
    expect(caps.spendTodayUsd(db)).toBe(0);
    expect(() => caps.checkCaps(1, db, limits)).not.toThrow();
  });

  it("logAnalysis writes a row that counts toward the caps", () => {
    caps.logAnalysis({ account_id: 7, model_id: "m", input_tokens: 10, output_tokens: 5, cost_usd: 0.25, ok: false, error: "refusal: no" }, db);
    expect(caps.photosToday(7, db)).toBe(1);
    expect(caps.spendTodayUsd(db)).toBeCloseTo(0.25);
    const row = db.prepare("SELECT ok, error FROM analysis_log WHERE account_id = 7").get() as { ok: number; error: string };
    expect(row).toEqual({ ok: 0, error: "refusal: no" });
  });
});
