import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderShareCard, breakdownRows, PHOTO_H } from "../server/sharecard/render.ts";
import type { ShareCardInput, IngredientLine } from "../server/types.ts";

const line = (name: string, price: number, estimated = false): IngredientLine =>
  ({ name, quantity: 1, unit: "each", price_cad: price, estimated });

const base: ShareCardInput = {
  photo_path: null,
  dish_name: "Tuna melt",
  ingredients: [line("canned tuna", 1.2), line("bread", 0.6), line("mayo", 0.15, true)],
  ingredient_total: 1.95,
  takeout_price: 14.5,
  saved: 12.55,
  pet_name: "Mochi",
  growth_stage: 1,
  referral_url: "https://chungi.ugmi.ca?ref=abc123",
};

let photoPath: string;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "chungi-d-"));
  photoPath = join(dir, "photo.jpg");
  await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#C07040" } })
    .jpeg().toFile(photoPath);
});

async function size(png: Buffer) {
  const m = await sharp(png).metadata();
  return { format: m.format, width: m.width, height: m.height };
}

describe("share card", () => {
  // Runs first so it sees the cold font load.
  it("reuses loaded fonts, second render is faster than the first", async () => {
    const t0 = performance.now();
    await renderShareCard(base);
    const cold = performance.now() - t0;
    const t1 = performance.now();
    await renderShareCard(base);
    const warm = performance.now() - t1;
    expect(warm).toBeLessThan(cold);
  });

  it("renders a 1080 by 1920 PNG with a photo", async () => {
    const png = await renderShareCard({ ...base, photo_path: photoPath });
    expect(await size(png)).toEqual({ format: "png", width: 1080, height: 1920 });
    // The photo area should carry the photo colour, not the placeholder block.
    const { dominant } = await sharp(png).extract({ left: 0, top: 0, width: 1080, height: 400 }).stats();
    expect(dominant.r).toBeGreaterThan(dominant.b);
  });

  it("renders with a null photo path", async () => {
    const png = await renderShareCard({ ...base, photo_path: null });
    expect(await size(png)).toEqual({ format: "png", width: 1080, height: 1920 });
  });

  it("falls back to the colour block when the photo file is gone", async () => {
    const png = await renderShareCard({ ...base, photo_path: "/nonexistent/photo.jpg" });
    expect(await size(png)).toEqual({ format: "png", width: 1080, height: 1920 });
  });

  it("draws text in the details area", async () => {
    const png = await renderShareCard(base);
    const stats = await sharp(png).extract({ left: 0, top: PHOTO_H, width: 1080, height: 1920 - PHOTO_H }).stats();
    // A blank background would have zero spread.
    expect(stats.channels[0].stdev).toBeGreaterThan(5);
  });

  it("folds long ingredient lists into +N more", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => line(`item ${i + 1}`, 1, i === 8));
    const rows = breakdownRows(nine);
    expect(rows).toHaveLength(7);
    expect(rows[6]).toEqual({ label: "+3 more", price: "~$3.00" });
    expect(rows[0]).toEqual({ label: "item 1", price: "$1.00" });
    expect(breakdownRows(nine.slice(0, 6))).toHaveLength(6);
    const png = await renderShareCard({ ...base, ingredients: nine });
    expect(await size(png)).toEqual({ format: "png", width: 1080, height: 1920 });
  });

  it("marks estimated prices with ~ and strips dashes from names", () => {
    const rows = breakdownRows([line("salt \u2014 pepper", 0.05, true)]);
    expect(rows[0]).toEqual({ label: "salt - pepper", price: "~$0.05" });
  });
});
