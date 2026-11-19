import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import sharp from "sharp";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// db.ts opens the database on import, so point it at a temp dir first.
process.env.CHUNGI_VAR = mkdtempSync(join(tmpdir(), "chungi-d-route-"));
delete process.env.CHUNGI_DB;

let app: Hono;
let mealId: number;
const TOKEN = "a".repeat(64);

beforeAll(async () => {
  const { db } = await import("../server/db.ts");
  const { register } = await import("../server/routes/card.ts");
  const acc = db.prepare("INSERT INTO account (token, pet_name, growth_stage, referral_code) VALUES (?, ?, ?, ?)")
    .run(TOKEN, "Mochi", 2, "abc123");
  db.prepare("INSERT INTO account (token, referral_code) VALUES (?, ?)").run("b".repeat(64), "zzz999");
  const meal = db.prepare(`INSERT INTO meal (account_id, photo_path, dish_name, ingredients, ingredient_total, takeout_price, saved)
    VALUES (?, NULL, ?, ?, ?, ?, ?)`).run(
    acc.lastInsertRowid, "Tuna melt",
    JSON.stringify([{ name: "tuna", quantity: 1, unit: "each", price_cad: 1.2, estimated: false }]),
    1.2, 14.5, 13.3,
  );
  mealId = Number(meal.lastInsertRowid);
  app = new Hono();
  register(app);
});

describe("card routes", () => {
  it("returns the PNG to the meal's owner", async () => {
    const res = await app.request(`/api/meals/${mealId}/card.png`, { headers: { Cookie: `chungi=${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([m.width, m.height]).toEqual([1080, 1920]);
  });

  it("404s without the cookie, with another account's cookie, or for a missing meal", async () => {
    expect((await app.request(`/api/meals/${mealId}/card.png`)).status).toBe(404);
    const other = await app.request(`/api/meals/${mealId}/card.png`, { headers: { Cookie: `chungi=${"b".repeat(64)}` } });
    expect(other.status).toBe(404);
    const missing = await app.request(`/api/meals/99999/card.png`, { headers: { Cookie: `chungi=${TOKEN}` } });
    expect(missing.status).toBe(404);
  });

  it("returns the share payload", async () => {
    const res = await app.request(`/api/meals/${mealId}/card.json`, { method: "POST", headers: { Cookie: `chungi=${TOKEN}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(/\?ref=abc123$/);
    expect(body.image_url).toMatch(new RegExp(`/api/meals/${mealId}/card.png$`));
    expect(typeof body.title).toBe("string");
    expect(body.text).toContain("Tuna melt");
    expect(body.text).not.toMatch(/[\u2013\u2014]/);
  });
});
