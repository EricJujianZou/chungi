import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env.CHUNGI_VAR = mkdtempSync(join(tmpdir(), "chungi-b-analysis-"));
process.env.CHUNGI_DB = join(process.env.CHUNGI_VAR, "test.sqlite");

const here = dirname(fileURLToPath(import.meta.url));
const PHOTO = join(here, "fixtures", "tuna-sandwich.jpg");

let oa: typeof import("../server/analysis/openai.ts");
let prompt: typeof import("../server/analysis/prompt.ts");
let analysis: typeof import("../server/analysis/index.ts");
let db: typeof import("../server/db.ts")["db"];

beforeAll(async () => {
  oa = await import("../server/analysis/openai.ts");
  prompt = await import("../server/analysis/prompt.ts");
  analysis = await import("../server/analysis/index.ts");
  db = (await import("../server/db.ts")).db;
  (await import("../server/analysis/pricing.ts")).resetPriceCache([]);
});
beforeEach(() => db.exec("DELETE FROM analysis_log"));
afterAll(() => oa.setClient(null));

const usage = { input_tokens: 2300, output_tokens: 300, input_tokens_details: { cached_tokens: 1000 } };
const textResponse = (text: string, extra: object = {}) => ({
  status: "completed", usage,
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
  ...extra,
});
const good = {
  confident: true, dish_name: "tuna sandwich",
  ingredients: [
    { name: "canned tuna", quantity: 85, unit: "g" },
    { name: "bread", quantity: 2, unit: "slice" },
    { name: "mystery sauce", quantity: 1, unit: "tbsp" },
  ],
  reaction: "a tuna sandwich — the uber eats guy is quietly wondering where you went",
  nutrition_note: "way less salt than the usual sub",
};

describe("system prompt", () => {
  it("holds the banned-word and style rules", () => {
    const p = prompt.SYSTEM_PROMPT;
    for (const w of ["quietly", "seamlessly", "effortlessly", "silently"]) expect(p).toContain(w);
    expect(p).toMatch(/no em dashes and no en dashes/i);
    expect(p).toMatch(/at most two sentences/i);
    expect(p).toMatch(/never mock the food/i);
    expect(p).toMatch(/fragment taglines/i);
    expect(p).toMatch(/lists of three/i);
    expect(p).toMatch(/nutrition_note field\)\n- Always null/i);
    expect(p).toMatch(/confident: set to false/i);
    expect(p).toMatch(/do not price anything/i);
    expect(p).toContain("you should share that on your story cus that looks FIRE");
  });
  it("contains no dashes itself", () => {
    expect(prompt.SYSTEM_PROMPT).not.toMatch(/[–—]/);
  });
  it("puts the user's takeout habit in the user text, not the system prompt", () => {
    const t = prompt.buildUserText({ account_id: 1, usual_source: "skip", usual_spend: 22, pet_name: "mochi" });
    expect(t).toContain("SkipTheDishes");
    expect(t).toContain("$22.00");
    expect(t).toContain("mochi");
    expect(prompt.SYSTEM_PROMPT).not.toContain("SkipTheDishes");
  });
});

describe("parseModelResponse", () => {
  it("reads a good response and cleans the copy", () => {
    const r = oa.parseModelResponse(textResponse(JSON.stringify(good)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.reaction).toBe("a tuna sandwich, the uber eats guy is wondering where you went");
    expect(r.usage).toEqual({ input_tokens: 2300, cached_tokens: 1000, output_tokens: 300 });
  });
  it("treats a refusal part as a fallback", () => {
    const r = oa.parseModelResponse({
      status: "completed", usage,
      output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] }],
    });
    expect(r).toMatchObject({ ok: false, reason: "refusal" });
  });
  it("treats a cut off response as a fallback", () => {
    const r = oa.parseModelResponse(textResponse('{"confident": tr', { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }));
    expect(r).toMatchObject({ ok: false, reason: "incomplete" });
  });
  it("treats non-JSON text as malformed", () => {
    expect(oa.parseModelResponse(textResponse("sure! here is the dish"))).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("treats JSON with the wrong shape as malformed", () => {
    const bad = { ...good, ingredients: [{ name: "x", quantity: "lots", unit: "handful" }] };
    expect(oa.parseModelResponse(textResponse(JSON.stringify(bad)))).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("treats an empty response as malformed", () => {
    expect(oa.parseModelResponse({ status: "completed", output: [] })).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("treats a not-food answer as a fallback", () => {
    const nf = { confident: false, dish_name: null, ingredients: [], reaction: "", nutrition_note: null };
    expect(oa.parseModelResponse(textResponse(JSON.stringify(nf)))).toMatchObject({ ok: false, reason: "not_food" });
  });
  it("drops a nutrition note that contains numbers", () => {
    const r = oa.parseModelResponse(textResponse(JSON.stringify({ ...good, nutrition_note: "about 450 calories" })));
    expect(r.ok && r.output.nutrition_note).toBe(null);
  });
});

describe("request and cost", () => {
  it("sends the system prompt first, then user text and image, strict schema, lowest effort", () => {
    const req = oa.buildRequest("gpt-6-luna", "user text", "data:image/jpeg;base64,AAAA");
    expect(req.input[0]).toEqual({ role: "system", content: prompt.SYSTEM_PROMPT });
    expect((req.input[1].content as any[])[0]).toMatchObject({ type: "input_text", text: "user text" });
    expect((req.input[1].content as any[])[1]).toMatchObject({ type: "input_image" });
    expect(req.text.format.strict).toBe(true);
    expect(req.reasoning.effort).toBe("none");
    expect(oa.lowestEffort("gpt-5-mini")).toBe("minimal");
  });
  it("costs cached tokens at the cached rate", () => {
    // 1300 uncached * 0.1 + 1000 cached * 0.01 + 300 out * 0.5, per million
    expect(oa.costUsd("gpt-6-luna", 2300, 1000, 300)).toBeCloseTo(0.00029, 8);
  });
  it("resizes the photo to a JPEG data URL", async () => {
    const url = await oa.photoToDataUrl(PHOTO);
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });
});

describe("analyzeMeal with a mocked client", () => {
  const ctx = { account_id: 42, usual_source: "uber_eats", usual_spend: 18, pet_name: null };
  const mock = (impl: (body: any) => Promise<any>) => {
    const calls: any[] = [];
    oa.setClient({ responses: { create: async (b: any) => { calls.push(b); return impl(b); } } });
    return calls;
  };

  it("prices the ingredients and logs the call", async () => {
    const calls = mock(async () => textResponse(JSON.stringify(good)));
    const r = await analysis.analyzeMeal(PHOTO, ctx);
    expect(calls).toHaveLength(1);
    expect(r.confident).toBe(true);
    expect(r.dish_name).toBe("tuna sandwich");
    expect(r.ingredients.map(l => l.estimated)).toEqual([false, false, true]);
    expect(r.ingredient_total).toBe(Math.round((0.89 + 0.3 + 0.75) * 100) / 100);
    expect(r.cost_usd).toBeGreaterThan(0);
    const row = db.prepare("SELECT ok, input_tokens, account_id FROM analysis_log").get() as any;
    expect(row).toEqual({ ok: 1, input_tokens: 2300, account_id: 42 });
  });

  it("returns a fallback result on a refusal without throwing", async () => {
    mock(async () => ({ status: "completed", usage, output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }));
    const r = await analysis.analyzeMeal(PHOTO, ctx);
    expect(r).toMatchObject({ confident: false, dish_name: null, reaction: "", ingredients: [], ingredient_total: 0 });
    const row = db.prepare("SELECT ok, error FROM analysis_log").get() as any;
    expect(row.ok).toBe(0);
    expect(row.error).toMatch(/^refusal/);
  });

  it("retries once on a network error, then succeeds", async () => {
    let n = 0;
    const calls = mock(async () => { if (n++ === 0) throw new Error("ECONNRESET"); return textResponse(JSON.stringify(good)); });
    const r = await analysis.analyzeMeal(PHOTO, ctx);
    expect(calls).toHaveLength(2);
    expect(r.confident).toBe(true);
  });

  it("throws after the retry fails and logs the error", async () => {
    mock(async () => { throw new Error("401 invalid key"); });
    await expect(analysis.analyzeMeal(PHOTO, ctx)).rejects.toThrow("401");
    const row = db.prepare("SELECT ok, error FROM analysis_log").get() as any;
    expect(row.ok).toBe(0);
  });

  it("throws CapError before calling the model when the account is over the limit", async () => {
    const calls = mock(async () => textResponse(JSON.stringify(good)));
    for (let i = 0; i < 20; i++) {
      db.exec("INSERT INTO analysis_log (account_id, model_id, cost_usd, ok) VALUES (42, 'm', 0, 1)");
    }
    await expect(analysis.analyzeMeal(PHOTO, ctx)).rejects.toBeInstanceOf(analysis.CapError);
    expect(calls).toHaveLength(0);
  });
});
