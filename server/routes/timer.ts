// Cooking timer sessions. Start closes any open session for the account.
// A1's meal route calls closeTimerSession(id, mealId) to attach a session to a meal.
import type { Hono } from "hono";
import { db } from "../db.ts";
import { line } from "../copy.ts";
import { getAccount } from "./_a2shim.ts";

type Session = { id: number; account_id: number; started_at: string; stopped_at: string | null; meal_id: number | null };

function seconds(s: { started_at: string; stopped_at: string | null }): number {
  const start = Date.parse(s.started_at);
  const stop = s.stopped_at ? Date.parse(s.stopped_at) : Date.now();
  return Math.max(0, Math.round((stop - start) / 1000));
}

function get(id: number): Session | undefined {
  return db.prepare("SELECT * FROM timer_session WHERE id = ?").get(id) as Session | undefined;
}

function stop(id: number) {
  db.prepare("UPDATE timer_session SET stopped_at = ? WHERE id = ? AND stopped_at IS NULL").run(new Date().toISOString(), id);
}

// Stops the session if still running, links it to the meal, returns its length
// in seconds. Returns null when the session does not exist.
export function closeTimerSession(id: number, mealId: number): number | null {
  if (!get(id)) return null;
  stop(id);
  db.prepare("UPDATE timer_session SET meal_id = ? WHERE id = ?").run(mealId, id);
  return seconds(get(id)!);
}

export function register(app: Hono) {
  app.post("/api/timer/start", async c => {
    const acct = await getAccount(c);
    db.prepare("UPDATE timer_session SET stopped_at = ? WHERE account_id = ? AND stopped_at IS NULL")
      .run(new Date().toISOString(), acct.id);
    // ISO timestamps (ms precision) rather than datetime('now'), so seconds are exact.
    const started = new Date().toISOString();
    const r = db.prepare("INSERT INTO timer_session (account_id, started_at) VALUES (?, ?)").run(acct.id, started);
    return c.json({ id: Number(r.lastInsertRowid), started_at: started, line: line("timer_start") });
  });

  app.post("/api/timer/stop", async c => {
    const acct = await getAccount(c);
    const body = await c.req.json().catch(() => ({})) as { id?: unknown };
    const id = Number(body.id);
    const s = Number.isInteger(id) ? get(id) : undefined;
    if (!s || s.account_id !== acct.id) return c.json({ error: "not_found" }, 404);
    stop(id);
    return c.json({ id, seconds: seconds(get(id)!) });
  });
}
