import { describe, it, expect, beforeAll } from "vitest";
import { loadApp, client } from "./a1-setup.ts";

let ctx: Awaited<ReturnType<typeof loadApp>>;
beforeAll(async () => { ctx = await loadApp(); });

describe("account cookie", () => {
  it("creates an account and sets the cookie on the first /api request", async () => {
    const res = await ctx.app.request("/api/me");
    expect(res.status).toBe(200);
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^chungi=[0-9a-f]{64};/);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Max-Age=34560000/);
    expect(set).not.toMatch(/Secure/); // PUBLIC_URL is http in tests
    const me = await res.json();
    expect(me.referral_code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(me.referral_url).toBe(`https://chungi.ugmi.ca/?ref=${me.referral_code}`);
    expect(me.balance).toBe(0);
    expect(me.meal_count).toBe(0);
    expect(me.comparison).toEqual({ usual_source: null, usual_spend: 18, set: false });
  });

  it("reuses the account when the cookie comes back, and replaces a bad cookie", async () => {
    const u = client(ctx.app);
    const a = await (await u.req("/api/me")).json();
    const again = await u.req("/api/me");
    expect(again.headers.get("set-cookie")).toBeNull();
    expect((await again.json()).id).toBe(a.id);

    const bad = await ctx.app.request("/api/me", { headers: { cookie: "chungi=nope" } });
    expect(bad.headers.get("set-cookie")).toMatch(/^chungi=/);
    expect((await bad.json()).id).not.toBe(a.id);
  });
});

describe("referral", () => {
  it("records referred_by from ?ref= on a new account", async () => {
    const referrer = await (await ctx.app.request("/api/me")).json();
    const res = await ctx.app.request(`/api/me?ref=${referrer.referral_code.toLowerCase()}`);
    expect((await res.json()).referred_by).toBe(referrer.id);
  });

  it("records referred_by from a JSON body ref and the route still reads the body", async () => {
    const referrer = await (await ctx.app.request("/api/me")).json();
    const u = client(ctx.app);
    const res = await u.json("/api/me", { ref: referrer.referral_code, pet_name: "Bao" });
    const me = await res.json();
    expect(me.referred_by).toBe(referrer.id);
    expect(me.pet_name).toBe("Bao");
  });

  it("ignores an unknown code and does not re-attribute an existing account", async () => {
    const u = client(ctx.app);
    const me = await (await u.req("/api/me?ref=ZZZZZZ")).json();
    expect(me.referred_by).toBeNull();
    const other = await (await ctx.app.request("/api/me")).json();
    const again = await (await u.req(`/api/me?ref=${other.referral_code}`)).json();
    expect(again.referred_by).toBeNull();
  });
});

describe("POST /api/me", () => {
  it("validates loosely and stores the recovery key", async () => {
    const u = client(ctx.app);
    expect((await u.json("/api/me", { pet_name: "" })).status).toBe(400);
    expect((await u.json("/api/me", { phone: "12" })).status).toBe(400);
    expect((await u.json("/api/me", { email: "nope" })).status).toBe(400);
    const me = await (await u.json("/api/me", { phone: "+1 (519) 555-0199", email: " Eat@Home.ca " })).json();
    expect(me.phone).toBe("+15195550199");
    expect(me.email).toBe("eat@home.ca");
  });
});

describe("comparison", () => {
  it("sets the onboarding price and rolls answers into it", async () => {
    const u = client(ctx.app);
    expect((await u.json("/api/comparison", { usual_source: "pizza", usual_spend: 20 })).status).toBe(400);
    expect((await u.json("/api/comparison", { usual_source: "skip", usual_spend: 0 })).status).toBe(400);
    const set = await (await u.json("/api/comparison", { usual_source: "skip", usual_spend: 20 })).json();
    expect(set.comparison).toEqual({ usual_source: "skip", usual_spend: 20, set: true });

    const ans = await (await u.json("/api/comparison/answer", { amount: 30 })).json();
    expect(ans.comparison.usual_spend).toBe(23); // 0.7 * 20 + 0.3 * 30
    expect(ans.comparison.usual_source).toBe("skip");
    const me = await (await u.req("/api/me")).json();
    const n = ctx.db.prepare("SELECT COUNT(*) AS n FROM comparison_answer WHERE account_id = ?").get(me.id) as { n: number };
    expect(n.n).toBe(1);
  });

  it("uses the first answer outright when there was no onboarding answer", async () => {
    const u = client(ctx.app);
    const ans = await (await u.json("/api/comparison/answer", { amount: 14.5 })).json();
    expect(ans.comparison.usual_spend).toBe(14.5);
  });
});
