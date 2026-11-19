// Lists the model ids the OpenAI key can see, GPT models first. Prints ids
// only, never the key. Run with the env file loaded in the same shell:
//   set -a; . ./.env; set +a; npx tsx scripts/pick-model.ts
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set in this shell");
  process.exit(1);
}
const client = new OpenAI();
const ids: string[] = [];
for await (const m of client.models.list()) ids.push(m.id);
ids.sort();
const gpt = ids.filter(id => /^gpt-[5-9]/.test(id));
console.log("GPT-5 class and newer:");
for (const id of gpt) console.log("  " + id);
console.log(`\n${ids.length} models visible in total`);
