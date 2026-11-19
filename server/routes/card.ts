// Share card routes.
// GET  /api/meals/:id/card.png   story-size PNG for the share sheet
// POST /api/meals/:id/card.json  payload the frontend hands to navigator.share
// Auth: until A1's account middleware lands, the `chungi` cookie token must
// match the meal's account token. Anything else is a 404 so meal ids cannot
// be probed.
import type { Hono, Context } from "hono";
import { getCookie } from "hono/cookie";
import { isAbsolute, join } from "node:path";
import { db, PHOTO_DIR } from "../db.ts";
import { config } from "../config.ts";
import { renderShareCard } from "../sharecard/render.ts";
import type { IngredientLine, ShareCardInput } from "../types.ts";

type Row = {
  id: number;
  photo_path: string | null;
  dish_name: string | null;
  ingredients: string;
  ingredient_total: number;
  takeout_price: number;
  saved: number;
  token: string;
  pet_name: string | null;
  growth_stage: number;
  referral_code: string;
};

const MEAL_SQL = `
  SELECT m.id, m.photo_path, m.dish_name, m.ingredients, m.ingredient_total,
         COALESCE(m.takeout_price, c.usual_spend) AS takeout_price, m.saved,
         a.token, a.pet_name, a.growth_stage, a.referral_code
  FROM meal m
  JOIN account a ON a.id = m.account_id
  LEFT JOIN comparison c ON c.account_id = a.id
  WHERE m.id = ?`;

function loadOwnedMeal(c: Context): Row | null {
  const id = Number(c.req.param("id"));
  const token = getCookie(c, "chungi");
  if (!Number.isInteger(id) || id <= 0 || !token) return null;
  const row = db.prepare(MEAL_SQL).get(id) as Row | undefined;
  if (!row || row.token !== token) return null;
  return row;
}

function referralUrl(row: Row): string {
  return `${config.landingUrl}?ref=${encodeURIComponent(row.referral_code)}`;
}

function parseIngredients(json: string): IngredientLine[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function toCardInput(row: Row): ShareCardInput {
  const photo = row.photo_path
    ? (isAbsolute(row.photo_path) ? row.photo_path : join(PHOTO_DIR, row.photo_path))
    : null;
  return {
    photo_path: photo,
    dish_name: row.dish_name ?? "home cooked",
    ingredients: parseIngredients(row.ingredients),
    ingredient_total: row.ingredient_total,
    takeout_price: row.takeout_price,
    saved: row.saved,
    pet_name: row.pet_name ?? "chungi",
    growth_stage: row.growth_stage,
    referral_url: referralUrl(row),
  };
}

export function register(app: Hono) {
  app.get("/api/meals/:id/card.png", async c => {
    const row = loadOwnedMeal(c);
    if (!row) return c.json({ error: "not found" }, 404);
    const png = await renderShareCard(toCardInput(row));
    return c.body(new Uint8Array(png), 200, {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    });
  });

  app.post("/api/meals/:id/card.json", c => {
    const row = loadOwnedMeal(c);
    if (!row) return c.json({ error: "not found" }, 404);
    const dish = (row.dish_name ?? "dinner").replace(/[\u2012-\u2015\u2212]/g, "-");
    // Share text is in the user's own voice, not the pet's. Placeholder copy.
    return c.json({
      title: "chungi",
      text: `I made ${dish} at home for $${row.ingredient_total.toFixed(2)} instead of $${row.takeout_price.toFixed(2)}.`,
      url: referralUrl(row),
      image_url: `${config.publicUrl}/api/meals/${row.id}/card.png`,
    });
  });
}
