import { describe, it, expect, beforeAll, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { loadApp, client, tinyJpeg, photoForm } from "./a1-setup.ts";

// Lets each test choose what the analysis does: the real stub, not confident, or throw.
const mode = vi.hoisted(() => ({ value: "stub" as "stub" | "unsure" | "throw" }));
vi.mock("../server/analysis/index.ts", async importOriginal => {
  const real = await importOriginal<typeof import("../server/analysis/index.ts")>();
  // Fixed result in place of a live model call; CapError comes from the real module.
  const fixed = {
    confident: true, dish_name: "tuna sandwich",
    ingredients: [
      { name: "canned tuna", quantity: 85, unit: "g", price_cad: 1.2, matched_id: "canned_tuna", estimated: false },
      { name: "bread", quantity: 2, unit: "slice", price_cad: 0.6, matched_id: "bread_white", estimated: false },
      { name: "greens", quantity: 40, unit: "g", price_cad: 1.1, estimated: true },
    ],
    ingredient_total: 2.9, reaction: "stub reaction", nutrition_note: null,
    model_id: "stub", input_tokens: 0, output_tokens: 0, cost_usd: 0, raw: {},
  };
  return {
    CapError: real.CapError,
    analyzeMeal: async () => {
      if (mode.value === "throw") throw new Error("model down");
      if (mode.value === "unsure") return { ...fixed, confident: false, dish_name: null, reaction: "unsure line" };
      return { ...fixed };
    },
  };
});

let ctx: Awaited<ReturnType<typeof loadApp>>;
let jpeg: Buffer;
beforeAll(async () => {
  ctx = await loadApp();
  jpeg = await tinyJpeg();
});

const post = (u: ReturnType<typeof client>, extra: Record<string, string> = {}) =>
  u.req("/api/meals", { method: "POST", body: photoForm(jpeg, extra) });

describe("POST /api/meals", () => {
  it("logs a meal, saves the photo, credits the wallet and grows the pet", async () => {
    mode.value = "stub";
    const u = client(ctx.app);
    await u.json("/api/comparison", { usual_source: "uber_eats", usual_spend: 14.5 });
    const res = await post(u);
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.meal.dish_name).toBe("tuna sandwich");
    expect(out.meal.confident).toBe(true);
    expect(out.meal.ingredients).toHaveLength(3);
    expect(out.meal.ingredient_total).toBe(2.9);
    expect(out.meal.takeout_price).toBe(14.5);
    expect(out.meal.saved).toBe(11.6);
    expect(out.meal.photo_url).toBe(`/api/meals/${out.meal.id}/photo`);
    expect(out.balance).toBe(11.6);
    expect(out.growth_stage).toBe(1);
    expect(out.grew).toBe(true);

    const row = ctx.db.prepare("SELECT photo_path FROM meal WHERE id = ?").get(out.meal.id) as { photo_path: string };
    expect(row.photo_path.startsWith(ctx.PHOTO_DIR)).toBe(true);
    expect(existsSync(row.photo_path)).toBe(true);

    const photo = await u.req(out.meal.photo_url);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");

    const wallet = await (await u.req("/api/wallet")).json();
    expect(wallet.balance).toBe(11.6);
    expect(wallet.ledger[0]).toMatchObject({ amount: 11.6, kind: "meal", ref_id: out.meal.id });
  });

  it("uses $18 when there is no onboarding answer", async () => {
    mode.value = "stub";
    const out = await (await post(client(ctx.app))).json();
    expect(out.meal.takeout_price).toBe(18);
    expect(out.meal.saved).toBe(15.1);
  });

  it("rejects a missing photo and a wrong file type", async () => {
    const u = client(ctx.app);
    expect((await u.req("/api/meals", { method: "POST", body: new FormData() })).status).toBe(400);
    const gif = photoForm(Buffer.from("GIF89a"), {}, "image/gif", "x.gif");
    expect((await u.req("/api/meals", { method: "POST", body: gif })).status).toBe(415);
  });

  it("stops a timer session and shows the per-dish trend", async () => {
    mode.value = "stub";
    const u = client(ctx.app);
    const me = await (await u.req("/api/me")).json();
    const start = (secsAgo: number) => Number(ctx.db.prepare(
      "INSERT INTO timer_session (account_id, started_at) VALUES (?, datetime('now', ?))"
    ).run(me.id, `-${secsAgo} seconds`).lastInsertRowid);

    const first = await (await post(u, { timer_session_id: String(start(2460)) })).json();
    expect(first.meal.timer_seconds).toBeGreaterThanOrEqual(2459);
    expect(first.meal.previous_timer_seconds).toBeNull();

    const sid = start(1440);
    const second = await (await post(u, { timer_session_id: String(sid) })).json();
    expect(second.meal.previous_timer_seconds).toBe(first.meal.timer_seconds);
    const sess = ctx.db.prepare("SELECT stopped_at, meal_id FROM timer_session WHERE id = ?").get(sid) as any;
    expect(sess.stopped_at).not.toBeNull();
    expect(sess.meal_id).toBe(second.meal.id);

    const list = await (await u.req("/api/meals")).json();
    expect(list.meals.map((m: any) => m.id)).toEqual([second.meal.id, first.meal.id]);
    expect(list.meals[0].previous_timer_seconds).toBe(first.meal.timer_seconds);

    // Another account cannot use this account's timer session.
    const other = await (await post(client(ctx.app), { timer_session_id: String(sid) })).json();
    expect(other.meal.timer_seconds).toBeNull();
  });

  it("follows the growth rule floor(sqrt(meals)) up to 6", async () => {
    const { stageForMeals } = await import("../server/routes/meals.ts");
    expect([0, 1, 3, 4, 8, 9, 35, 36, 100].map(stageForMeals)).toEqual([0, 1, 1, 2, 2, 3, 5, 6, 6]);
  });
});

describe("fallback path", () => {
  it("logs the meal with the $4 estimate and reaction null when analysis throws", async () => {
    mode.value = "throw";
    const u = client(ctx.app);
    const out = await (await post(u)).json();
    expect(out.analysis_failed).toBe(true);
    expect(out.meal.confident).toBe(false);
    expect(out.meal.reaction).toBeNull();
    expect(out.meal.ingredient_total).toBe(4);
    expect(out.meal.saved).toBe(14);
    expect(out.balance).toBe(14);

    const named = await (await u.json(`/api/meals/${out.meal.id}/name`, { dish_name: "  mapo tofu " })).json();
    expect(named.meal.dish_name).toBe("mapo tofu");
    expect((await u.json(`/api/meals/${out.meal.id}/name`, { dish_name: "" })).status).toBe(400);
  });

  it("uses the estimate when analysis is not confident", async () => {
    mode.value = "unsure";
    const out = await (await post(client(ctx.app))).json();
    expect(out.meal.confident).toBe(false);
    expect(out.meal.dish_name).toBeNull();
    expect(out.meal.ingredient_total).toBe(4);
    expect(out.meal.reaction).toBe("unsure line");
    expect(out.analysis_failed).toBe(false);
  });

  it("does not show one account's meal to another", async () => {
    mode.value = "stub";
    const out = await (await post(client(ctx.app))).json();
    expect((await client(ctx.app).req(`/api/meals/${out.meal.id}`)).status).toBe(404);
  });
});

describe("wallet helpers", () => {
  it("debit refuses when the balance is too low", async () => {
    const { creditWallet, debitWallet, getBalance } = await import("../server/routes/wallet.ts");
    const me = await (await ctx.app.request("/api/me")).json();
    expect(creditWallet(me.id, 5.1, "meal")).toBe(5.1);
    expect(debitWallet(me.id, 6, "cosmetic", 1)).toEqual({ ok: false, balance: 5.1 });
    expect(debitWallet(me.id, 5.1, "cosmetic", 1)).toEqual({ ok: true, balance: 0 });
    expect(getBalance(me.id)).toBe(0);
  });
});

describe("retention", () => {
  it("deletes old unkept photos and leaves kept or recent ones", async () => {
    mode.value = "stub";
    const { purgeOldPhotos } = await import("../server/retention.ts");
    const u = client(ctx.app);
    const old = (await (await post(u)).json()).meal;
    const kept = (await (await post(u)).json()).meal;
    const fresh = (await (await post(u)).json()).meal;
    const toggled = await (await u.req(`/api/meals/${kept.id}/keep`, { method: "POST" })).json();
    expect(toggled.meal.keep_photo).toBe(true);
    ctx.db.prepare("UPDATE meal SET created_at = datetime('now', '-25 hours') WHERE id IN (?, ?)").run(old.id, kept.id);
    const path = (id: number) =>
      (ctx.db.prepare("SELECT photo_path FROM meal WHERE id = ?").get(id) as { photo_path: string | null }).photo_path;
    const oldPath = path(old.id)!;

    const before = readdirSync(ctx.PHOTO_DIR).length;
    expect(await purgeOldPhotos()).toBeGreaterThanOrEqual(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(path(old.id)).toBeNull();
    expect(path(kept.id)).not.toBeNull();
    expect(existsSync(path(kept.id)!)).toBe(true);
    expect(path(fresh.id)).not.toBeNull();
    expect(readdirSync(ctx.PHOTO_DIR).length).toBeLessThan(before);

    const after = await (await u.req(`/api/meals/${old.id}`)).json();
    expect(after.meal.has_photo).toBe(false);
    expect(after.meal.photo_url).toBeNull();
  });
});
