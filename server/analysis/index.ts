// Meal photo analysis: caps, one model call, pricing from the table, log.
// Throws CapError when a cap is hit, and a plain Error only for network or
// auth failures after one retry. Everything else returns a result; when
// confident is false the route uses the scripted fallback line, and
// reaction is an empty string.
import type { AnalysisResult, AnalysisContext } from "../types.ts";
import { config } from "../config.ts";
import { checkCaps, logAnalysis } from "./caps.ts";
import { callModel, costUsd, photoToDataUrl } from "./openai.ts";
import { buildUserText } from "./prompt.ts";
import { priceIngredients } from "./pricing.ts";

export { CapError } from "./caps.ts";

export async function analyzeMeal(photoPath: string, ctx: AnalysisContext): Promise<AnalysisResult> {
  checkCaps(ctx.account_id);
  const model = config.openaiModel;
  const dataUrl = await photoToDataUrl(photoPath);

  let parsed;
  try {
    parsed = await callModel(model, buildUserText(ctx), dataUrl);
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logAnalysis({ account_id: ctx.account_id, model_id: model, input_tokens: 0, output_tokens: 0, cost_usd: 0, ok: false, error: message.slice(0, 500) });
    throw err;
  }

  const { usage } = parsed;
  const cost = costUsd(model, usage.input_tokens, usage.cached_tokens, usage.output_tokens);
  logAnalysis({
    account_id: ctx.account_id, model_id: model,
    input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: cost,
    ok: parsed.ok, error: parsed.ok ? null : `${parsed.reason}: ${parsed.detail}`.slice(0, 500),
  });

  const base = { model_id: model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: cost, raw: parsed.raw };
  if (!parsed.ok) {
    return { ...base, confident: false, dish_name: null, ingredients: [], ingredient_total: 0, reaction: "", nutrition_note: null };
  }
  const { lines, total } = priceIngredients(parsed.output.ingredients);
  return {
    ...base,
    confident: true,
    dish_name: parsed.output.dish_name,
    ingredients: lines,
    ingredient_total: total,
    reaction: parsed.output.reaction,
    nutrition_note: parsed.output.nutrition_note,
  };
}
