// One OpenAI Responses API call per meal photo, with strict JSON schema
// output. Model content problems (refusal, cut off, junk JSON, not food)
// never throw; they come back as a fallback result. Only network or auth
// failures throw, after one retry.
import OpenAI from "openai";
import sharp from "sharp";
import { z } from "zod";
import { SYSTEM_PROMPT, BANNED_ADVERBS } from "./prompt.ts";

// USD per 1M tokens, from https://developers.openai.com/api/docs/pricing and
// the per-model pages, checked 2026-10-07. Image tokens are billed as input
// tokens, so usage.input_tokens already includes the photo.
export const PRICES_CHECKED_ON = "2026-10-07";
export const MODEL_PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6.1-sol": { input: 2.0, cached: 0.2, output: 10.0 },  // cached rate assumed at 10%, not listed
  "gpt-6-astra": { input: 10.0, cached: 1.0, output: 50.0 }, // cached rate assumed at 10%, not listed
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2.0, cached: 0.2, output: 12.0 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.4 },
};
// Unknown model ids are costed at a deliberately high rate so the daily
// spend cap still trips early instead of counting them as free.
const UNKNOWN_MODEL_PRICE = { input: 10.0, cached: 1.0, output: 50.0 };

// Lowest reasoning effort each model accepts. GPT-6 and 5.1+ take "none",
// the original GPT-5 family bottoms out at "minimal".
export function lowestEffort(model: string): string {
  if (/^gpt-5(-mini|-nano)?$/.test(model) || /^gpt-5-(mini|nano)-\d/.test(model)) return "minimal";
  return "none";
}

export function costUsd(model: string, inputTokens: number, cachedTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")] ?? UNKNOWN_MODEL_PRICE;
  const uncached = Math.max(0, inputTokens - cachedTokens);
  return (uncached * p.input + cachedTokens * p.cached + outputTokens * p.output) / 1_000_000;
}

export const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["confident", "dish_name", "ingredients", "reaction", "nutrition_note"],
  properties: {
    confident: { type: "boolean" },
    dish_name: { type: ["string", "null"] },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit"],
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string", enum: ["g", "ml", "each", "slice", "cup", "tbsp"] },
        },
      },
    },
    reaction: { type: "string" },
    nutrition_note: { type: ["string", "null"] },
  },
} as const;

const ModelOutput = z.object({
  confident: z.boolean(),
  dish_name: z.string().nullable(),
  ingredients: z.array(z.object({
    name: z.string().min(1),
    quantity: z.number(),
    unit: z.enum(["g", "ml", "each", "slice", "cup", "tbsp"]),
  })),
  reaction: z.string(),
  nutrition_note: z.string().nullable(),
});
export type ModelOutput = z.infer<typeof ModelOutput>;

// Resize to long edge 1024 and JPEG quality 80, then base64 data URL.
export async function photoToDataUrl(photoPath: string): Promise<string> {
  const buf = await sharp(photoPath)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

// Last line of defence on the rules the prompt already states.
export function cleanCopy(text: string): string {
  let out = text.replace(/\s*[—–]\s*/g, ", ");
  for (const w of BANNED_ADVERBS) out = out.replace(new RegExp(`\\s*\\b${w}\\b`, "gi"), "");
  return out.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
}

export type Usage = { input_tokens: number; cached_tokens: number; output_tokens: number };

export type Parsed =
  | { ok: true; output: ModelOutput; usage: Usage; raw: unknown }
  | { ok: false; reason: "refusal" | "incomplete" | "malformed" | "not_food"; detail: string; usage: Usage; raw: unknown };

// Minimal view of a Responses API result, so tests can pass plain objects.
export type ResponseLike = {
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | null;
};

export function parseModelResponse(res: ResponseLike): Parsed {
  const usage: Usage = {
    input_tokens: res.usage?.input_tokens ?? 0,
    cached_tokens: res.usage?.input_tokens_details?.cached_tokens ?? 0,
    output_tokens: res.usage?.output_tokens ?? 0,
  };
  const raw = res;
  let text = "";
  for (const item of res.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal") {
        return { ok: false, reason: "refusal", detail: part.refusal ?? "refused", usage, raw };
      }
      if (part.type === "output_text" && part.text) text += part.text;
    }
  }
  if (res.status && res.status !== "completed") {
    return { ok: false, reason: "incomplete", detail: `${res.status}: ${res.incomplete_details?.reason ?? "unknown"}`, usage, raw };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed", detail: `not JSON: ${text.slice(0, 120)}`, usage, raw };
  }
  const checked = ModelOutput.safeParse(json);
  if (!checked.success) {
    return { ok: false, reason: "malformed", detail: checked.error.issues[0]?.message ?? "schema mismatch", usage, raw: json };
  }
  const out = checked.data;
  if (!out.confident || !out.dish_name || !out.dish_name.trim() || !out.reaction.trim()) {
    return { ok: false, reason: "not_food", detail: "model was not confident", usage, raw: json };
  }
  return {
    ok: true,
    usage,
    raw: json,
    output: {
      ...out,
      dish_name: out.dish_name.trim(),
      reaction: cleanCopy(out.reaction),
      nutrition_note: out.nutrition_note ? stripNumbers(cleanCopy(out.nutrition_note)) : null,
    },
  };
}

// nutrition_note is qualitative only; drop it entirely if a number slipped in.
function stripNumbers(note: string): string | null {
  return /\d/.test(note) ? null : note;
}

// The subset of the OpenAI client this module uses, so tests can mock it.
export type ResponsesClient = {
  responses: { create: (body: any) => Promise<ResponseLike> };
};

let client: ResponsesClient | null = null;

export function getClient(): ResponsesClient {
  if (!client) client = new OpenAI({ maxRetries: 0, timeout: 60_000 }) as unknown as ResponsesClient;
  return client;
}

export function setClient(c: ResponsesClient | null): void {
  client = c;
}

export function buildRequest(model: string, userText: string, dataUrl: string) {
  return {
    model,
    store: false,
    reasoning: { effort: lowestEffort(model) },
    max_output_tokens: 1500,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text: userText },
          { type: "input_image", image_url: dataUrl, detail: "auto" },
        ],
      },
    ],
    text: {
      format: { type: "json_schema", name: "meal_analysis", strict: true, schema: RESPONSE_SCHEMA },
    },
  };
}

// Sends the request, retrying once on any thrown error (network, 5xx, rate
// limit, auth). The second failure is thrown to the caller.
export async function callModel(model: string, userText: string, dataUrl: string): Promise<Parsed> {
  const body = buildRequest(model, userText, dataUrl);
  let res: ResponseLike;
  try {
    res = await getClient().responses.create(body);
  } catch {
    await new Promise(r => setTimeout(r, 750));
    res = await getClient().responses.create(body);
  }
  return parseModelResponse(res);
}
