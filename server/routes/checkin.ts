// Daily check-in: "cooking tonight or ordering?" One row per account per
// Toronto day; answering again the same day replaces the answer.
import type { Hono } from "hono";
import { db } from "../db.ts";
import { line } from "../copy.ts";
import { getAccount } from "./_a2shim.ts";
import { localDay } from "./_a2time.ts";

type Answer = "cooking" | "ordering";

export function register(app: Hono) {
  app.get("/api/checkin/today", async c => {
    const acct = await getAccount(c);
    const day = localDay();
    const row = db.prepare("SELECT answer FROM checkin WHERE account_id = ? AND day = ?").get(acct.id, day) as
      | { answer: Answer }
      | undefined;
    return c.json({ day, answer: row?.answer ?? null, question: line("checkin_question") });
  });

  app.post("/api/checkin", async c => {
    const acct = await getAccount(c);
    const body = await c.req.json().catch(() => ({})) as { answer?: unknown };
    const answer = body.answer;
    if (answer !== "cooking" && answer !== "ordering") return c.json({ error: "invalid_answer" }, 400);
    const day = localDay();
    db.prepare(
      `INSERT INTO checkin (account_id, answer, day) VALUES (?, ?, ?)
       ON CONFLICT (account_id, day) DO UPDATE SET answer = excluded.answer`,
    ).run(acct.id, answer, day);
    const ordering = answer === "ordering";
    return c.json({
      day,
      answer,
      line: line(ordering ? "checkin_ordering" : "checkin_cooking"),
      // Frontend asks "what would tonight have been?" (A1's route) when true.
      prompt_comparison: ordering,
      comparison_question: ordering ? line("comparison_question") : null,
    });
  });
}
