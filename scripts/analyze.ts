// Runs the real analysis on photos and prints dish, total, reaction and cost
// as a markdown table. Uses a throwaway database so caps and logs do not touch
// var/. Run with the env file loaded in the same shell:
//   set -a; . ./.env; set +a; npx tsx scripts/analyze.ts test/fixtures/*.jpg
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

process.env.CHUNGI_VAR ??= mkdtempSync(join(tmpdir(), "chungi-analyze-"));

const photos = process.argv.slice(2);
if (photos.length === 0) {
  console.error("usage: tsx scripts/analyze.ts <photo> [photo...]");
  process.exit(1);
}

const { db } = await import("../server/db.ts");
const { analyzeMeal } = await import("../server/analysis/index.ts");
const { config } = await import("../server/config.ts");

db.prepare("INSERT OR IGNORE INTO account (id, token, referral_code) VALUES (1, 'script', 'script')").run();

console.log(`model: ${config.openaiModel}\n`);
console.log("| Photo | Dish | Ingredient total (CAD) | Reaction | Nutrition note | Tokens in/out | Cost (USD) |");
console.log("|---|---|---|---|---|---|---|");
let spend = 0;
for (const p of photos) {
  const r = await analyzeMeal(p, { account_id: 1, usual_source: "uber_eats", usual_spend: 18, pet_name: null });
  spend += r.cost_usd;
  const dish = r.confident ? r.dish_name : "(not confident, fallback)";
  const lines = r.ingredients.map(l => `${l.name} $${l.price_cad.toFixed(2)}${l.estimated ? "~" : ""}`).join(", ");
  console.log(`| ${basename(p)} | ${dish} | $${r.ingredient_total.toFixed(2)} (${lines}) | ${r.reaction} | ${r.nutrition_note ?? ""} | ${r.input_tokens}/${r.output_tokens} | $${r.cost_usd.toFixed(5)} |`);
}
console.log(`\ntotal spend: $${spend.toFixed(5)}  (~ marks an estimated line)`);
