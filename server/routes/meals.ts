// Meal log. A photo comes in, the analysis prices it, the saved amount goes
// into the wallet and the pet may grow a stage.
import type { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db, PHOTO_DIR } from "../db.ts";
import { config } from "../config.ts";
import { analyzeMeal, CapError } from "../analysis/index.ts";
import type { AnalysisResult, IngredientLine } from "../types.ts";
import { getAccount, getComparison } from "./account.ts";
import { creditWallet, getBalance } from "./wallet.ts";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
  "image/heic": ".heic", "image/heif": ".heic",
};
const EXT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".png": "image/png", ".heic": "image/heic",
};
export const MAX_STAGE = 6;

// Growth rule: stage = floor(sqrt(meals logged)), capped at 6. Stages arrive
// at meals 1, 4, 9, 16, 25 and 36, so the first growth comes right away and
// later ones take longer, the way a pet game paces level-ups.
export function stageForMeals(meals: number): number {
  return Math.min(MAX_STAGE, Math.floor(Math.sqrt(Math.max(0, meals))));
}

type MealRow = {
  id: number; account_id: number; photo_path: string | null; keep_photo: number;
  dish_name: string | null; confident: number; ingredients: string; ingredient_total: number;
  takeout_price: number; saved: number; reaction: string | null; nutrition_note: string | null;
  timer_seconds: number | null; model_id: string | null; input_tokens: number | null;
  output_tokens: number | null; cost_usd: number | null; raw_response: string | null;
  created_at: string; previous_timer_seconds?: number | null;
};

// The shape the frontend gets. The disk path and raw model JSON stay server side.
function publicMeal(m: MealRow) {
  return {
    id: m.id,
    dish_name: m.dish_name,
    confident: m.confident === 1,
    ingredients: JSON.parse(m.ingredients) as IngredientLine[],
    ingredient_total: m.ingredient_total,
    takeout_price: m.takeout_price,
    saved: m.saved,
    reaction: m.reaction,
    nutrition_note: m.nutrition_note,
    timer_seconds: m.timer_seconds,
    previous_timer_seconds: m.previous_timer_seconds ?? null,
    keep_photo: m.keep_photo === 1,
    has_photo: m.photo_path !== null,
    photo_url: m.photo_path ? `/api/meals/${m.id}/photo` : null,
    created_at: m.created_at,
  };
}

// For each meal, the timer_seconds of the most recent earlier meal with the
// same dish name (case-insensitive) that also had a timer. That pair is the
// personal trend, "your pasta is down from 41 to 24 minutes".
const MEAL_SELECT = `
  SELECT m.*, (
    SELECT p.timer_seconds FROM meal p
    WHERE p.account_id = m.account_id AND p.id < m.id AND p.timer_seconds IS NOT NULL
      AND m.dish_name IS NOT NULL AND lower(trim(p.dish_name)) = lower(trim(m.dish_name))
    ORDER BY p.id DESC LIMIT 1
  ) AS previous_timer_seconds
  FROM meal m`;

export function getMealRow(accountId: number, id: number): MealRow | undefined {
  return db.prepare(`${MEAL_SELECT} WHERE m.account_id = ? AND m.id = ?`).get(accountId, id) as MealRow | undefined;
}

const cents = (n: number) => Math.round(n * 100) / 100;

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Stops the timer session the photo belongs to and returns its length in
// seconds. Ignores sessions that are not this account's.
function closeTimer(accountId: number, sessionId: number, mealId: number): number | null {
  const row = db.prepare(`
    SELECT CAST(ROUND((julianday(COALESCE(stopped_at, datetime('now'))) - julianday(started_at)) * 86400) AS INTEGER) AS secs
    FROM timer_session WHERE id = ? AND account_id = ?
  `).get(sessionId, accountId) as { secs: number } | undefined;
  if (!row) return null;
  db.prepare(`
    UPDATE timer_session SET stopped_at = COALESCE(stopped_at, datetime('now')), meal_id = ? WHERE id = ?
  `).run(mealId, sessionId);
  return Math.max(0, row.secs);
}

export function register(app: Hono) {
  app.post("/api/meals", async c => {
    const acct = getAccount(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ error: "send the photo as multipart form data" }, 400);
    }
    const photo = body.photo;
    if (!(photo instanceof File)) return c.json({ error: "photo is missing" }, 400);
    if (photo.size === 0) return c.json({ error: "photo is empty" }, 400);
    if (photo.size > MAX_PHOTO_BYTES) return c.json({ error: "photo is over 8 MB" }, 413);
    let ext: string | undefined = PHOTO_TYPES[photo.type.toLowerCase()];
    if (!ext) {
      // Some phones send HEIC with an empty or generic type; fall back to the name.
      const m = /\.(jpe?g|png|heic|heif)$/i.exec(photo.name ?? "");
      if (m) ext = { jpg: ".jpg", jpeg: ".jpg", png: ".png", heic: ".heic", heif: ".heic" }[m[1].toLowerCase()];
    }
    if (!ext) return c.json({ error: "photo must be a JPEG, PNG or HEIC" }, 415);

    const photoPath = join(PHOTO_DIR, randomBytes(16).toString("hex") + ext);
    await writeFile(photoPath, Buffer.from(await photo.arrayBuffer()));

    const cmp = getComparison(acct.id);
    const takeoutPrice = cmp.usual_spend;

    let analysis: AnalysisResult | null = null;
    // Why the pet falls back, so the frontend picks the right scripted line:
    // "cap" (daily photo or spend cap), "cannot_name", "error", or null.
    let fallbackReason: "cap" | "cannot_name" | "error" | null = null;
    try {
      const recent = db.prepare(
        "SELECT reaction FROM meal WHERE account_id = ? AND reaction IS NOT NULL AND reaction != '' ORDER BY id DESC LIMIT 5",
      ).all(acct.id) as { reaction: string }[];
      analysis = await analyzeMeal(photoPath, {
        account_id: acct.id, usual_source: cmp.usual_source, usual_spend: cmp.usual_spend, pet_name: acct.pet_name,
        recent_reactions: recent.map(r => r.reaction),
      });
    } catch (err) {
      fallbackReason = err instanceof CapError ? "cap" : "error";
      console.error("analyzeMeal failed:", (err as Error)?.message ?? err);
    }
    if (!fallbackReason && analysis && !analysis.confident) fallbackReason = "cannot_name";

    // Not confident or analysis failed: credit takeout price minus the flat
    // estimate. A thrown analysis gets reaction null so the
    // frontend shows the scripted fallback line.
    const confident = analysis?.confident === true;
    const ingredients = confident ? analysis!.ingredients : [];
    const ingredientTotal = cents(confident ? analysis!.ingredient_total : config.fallbackIngredientEstimate);
    const saved = cents(Math.max(0, takeoutPrice - ingredientTotal));

    const timerId = body.timer_session_id != null && body.timer_session_id !== ""
      ? parseId(String(body.timer_session_id)) : null;

    let mealId = 0;
    let grew = false;
    let stage = acct.growth_stage;
    db.exec("BEGIN IMMEDIATE");
    try {
      const res = db.prepare(`
        INSERT INTO meal (account_id, photo_path, dish_name, confident, ingredients, ingredient_total,
          takeout_price, saved, reaction, nutrition_note, model_id, input_tokens, output_tokens, cost_usd, raw_response)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        acct.id, photoPath, confident ? analysis!.dish_name : null, confident ? 1 : 0,
        JSON.stringify(ingredients), ingredientTotal, takeoutPrice, saved,
        analysis ? analysis.reaction : null, analysis?.nutrition_note ?? null,
        analysis?.model_id ?? null, analysis?.input_tokens ?? null, analysis?.output_tokens ?? null,
        analysis?.cost_usd ?? null, analysis ? JSON.stringify(analysis.raw ?? null) : null,
      );
      mealId = Number(res.lastInsertRowid);

      if (timerId) {
        const secs = closeTimer(acct.id, timerId, mealId);
        if (secs !== null) db.prepare("UPDATE meal SET timer_seconds = ? WHERE id = ?").run(secs, mealId);
      }

      if (saved > 0) creditWallet(acct.id, saved, "meal", mealId);

      const { n } = db.prepare("SELECT COUNT(*) AS n FROM meal WHERE account_id = ?").get(acct.id) as { n: number };
      const newStage = Math.max(acct.growth_stage, stageForMeals(n));
      if (newStage !== acct.growth_stage) {
        db.prepare("UPDATE account SET growth_stage = ? WHERE id = ?").run(newStage, acct.id);
        grew = true;
        stage = newStage;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return c.json({
      fallback_reason: fallbackReason,
      meal: publicMeal(getMealRow(acct.id, mealId)!),
      balance: getBalance(acct.id),
      growth_stage: stage,
      grew,
      analysis_failed: analysis === null,
    }, 201);
  });

  app.get("/api/meals", c => {
    const acct = getAccount(c);
    const rows = db.prepare(`${MEAL_SELECT} WHERE m.account_id = ? ORDER BY m.id DESC`).all(acct.id) as MealRow[];
    return c.json({ meals: rows.map(publicMeal) });
  });

  app.get("/api/meals/:id", c => {
    const acct = getAccount(c);
    const id = parseId(c.req.param("id"));
    const row = id ? getMealRow(acct.id, id) : undefined;
    if (!row) return c.json({ error: "meal not found" }, 404);
    return c.json({ meal: publicMeal(row) });
  });

  // Serves the photo to its owner only, while it still exists.
  app.get("/api/meals/:id/photo", async c => {
    const acct = getAccount(c);
    const id = parseId(c.req.param("id"));
    const row = id ? getMealRow(acct.id, id) : undefined;
    if (!row?.photo_path) return c.json({ error: "photo not found" }, 404);
    try {
      const buf = await readFile(row.photo_path);
      const ext = row.photo_path.slice(row.photo_path.lastIndexOf("."));
      return c.body(buf, 200, {
        "content-type": EXT_TYPES[ext] ?? "application/octet-stream",
        "cache-control": "private, max-age=3600",
      });
    } catch {
      return c.json({ error: "photo not found" }, 404);
    }
  });

  // Fallback path: the user types what the dish was.
  app.post("/api/meals/:id/name", async c => {
    const acct = getAccount(c);
    const id = parseId(c.req.param("id"));
    if (!id || !getMealRow(acct.id, id)) return c.json({ error: "meal not found" }, 404);
    let b: Record<string, unknown> = {};
    try { b = await c.req.json(); } catch { /* handled below */ }
    const name = typeof b?.dish_name === "string" ? b.dish_name.trim() : "";
    if (name.length < 1 || name.length > 80) return c.json({ error: "dish_name must be 1 to 80 characters" }, 400);
    db.prepare("UPDATE meal SET dish_name = ? WHERE id = ? AND account_id = ?").run(name, id, acct.id);
    return c.json({ meal: publicMeal(getMealRow(acct.id, id)!) });
  });

  // Keep the photo past the 24 hour cleanup, or stop keeping it. With a JSON
  // body {keep: true|false} it sets that value, with no body it toggles.
  app.post("/api/meals/:id/keep", async c => {
    const acct = getAccount(c);
    const id = parseId(c.req.param("id"));
    const row = id ? getMealRow(acct.id, id) : undefined;
    if (!row) return c.json({ error: "meal not found" }, 404);
    let b: Record<string, unknown> = {};
    try { b = await c.req.json(); } catch { /* no body means toggle */ }
    const keep = typeof b?.keep === "boolean" ? b.keep : row.keep_photo === 0;
    db.prepare("UPDATE meal SET keep_photo = ? WHERE id = ?").run(keep ? 1 : 0, row.id);
    return c.json({ meal: publicMeal(getMealRow(acct.id, row.id)!) });
  });
}
