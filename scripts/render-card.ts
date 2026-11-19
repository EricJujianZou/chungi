// Renders a sample share card with fixture data.
// Usage: npx tsx scripts/render-card.ts out.png
import sharp from "sharp";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderShareCard } from "../server/sharecard/render.ts";
import type { ShareCardInput } from "../server/types.ts";

const out = process.argv[2];
if (!out) {
  console.error("usage: npx tsx scripts/render-card.ts <out.png>");
  process.exit(1);
}

// Sample photo: a 1200 by 900 warm gradient, standing in for a plate shot.
const dir = await mkdtemp(join(tmpdir(), "chungi-card-"));
const photoPath = join(dir, "sample.jpg");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#F2B36B"/><stop offset="1" stop-color="#7A3E1D"/>
  </linearGradient></defs>
  <rect width="1200" height="900" fill="url(#g)"/></svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(photoPath);

const sample: ShareCardInput = {
  photo_path: photoPath,
  dish_name: "Tuna melt with greens",
  ingredients: [
    { name: "canned tuna", quantity: 1, unit: "each", price_cad: 1.2, matched_id: "tuna-can", estimated: false },
    { name: "mixed greens", quantity: 60, unit: "g", price_cad: 1.1, matched_id: "greens", estimated: false },
    { name: "sourdough bread", quantity: 2, unit: "slice", price_cad: 0.6, matched_id: "bread", estimated: false },
    { name: "cheddar", quantity: 30, unit: "g", price_cad: 0.45, matched_id: "cheddar", estimated: false },
    { name: "mayo", quantity: 1, unit: "tbsp", price_cad: 0.15, estimated: true },
  ],
  ingredient_total: 3.5,
  takeout_price: 14.5,
  saved: 11.0,
  pet_name: "Mochi",
  growth_stage: 2,
  referral_url: "https://chungi.ugmi.ca?ref=abc123",
};

const t0 = performance.now();
const png = await renderShareCard(sample);
const cold = performance.now() - t0;
const t1 = performance.now();
await renderShareCard(sample);
const warm = performance.now() - t1;

await writeFile(out, png);
const meta = await sharp(png).metadata();
console.log(`${out}: ${meta.width}x${meta.height}, ${png.length} bytes`);
console.log(`render cold ${cold.toFixed(0)} ms, warm ${warm.toFixed(0)} ms`);
