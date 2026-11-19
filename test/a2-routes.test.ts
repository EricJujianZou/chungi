import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

process.env.NODE_ENV = "test";
process.env.CHUNGI_VAR = mkdtempSync(join(tmpdir(), "chungi-a2-"));
delete process.env.CHUNGI_DB;

let app: Hono;
let db: typeof import("../server/db.ts").db;
let shim: typeof import("../server/routes/_a2shim.ts");
let timer: typeof import("../server/routes/timer.ts");
let signup: typeof import("../server/routes/signup.ts");
let copy: typeof import("../server/copy.ts");

beforeAll(async () => {
  db = (await import("../server/db.ts")).db;
  shim = await import("../server/routes/_a2shim.ts");
  timer = await import("../server/routes/timer.ts");
  signup = await import("../server/routes/signup.ts");
  copy = await import("../server/copy.ts");
  app = new Hono();
  for (const m of ["cosmetics", "friends", "signup", "checkin", "timer"]) {
    (await import(`../server/routes/${m}.ts`)).register(app);
  }
});

type User = { cookie: string; id: number; code: string };

async function newUser(): Promise<User> {
  const res = await app.request("/api/friends/code");
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const { code } = await res.json();
  const { id } = db.prepare("SELECT id FROM account WHERE referral_code = ?").get(code) as { id: number };
  return { cookie, id, code };
}

function req(u: User | null, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  if (u) h.cookie = u.cookie;
  if (body !== undefined) h["content-type"] = "application/json";
  return app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("copy", () => {
  it("has every required key with 1 to 3 variants and no dashes", () => {
    const keys = ["first_open", "name_prompt", "checkin_question", "checkin_cooking", "checkin_ordering",
      "timer_start", "timer_running", "photo_waiting", "fallback_cannot_name", "cap_reached",
      "cosmetic_bought", "share_prompt", "recovery_key_offer", "comparison_question",
      ...[1, 2, 3, 4, 5, 6].map(n => `growth_stage_up_${n}`)];
    for (const k of keys) {
      const v = copy.COPY[k];
      expect(v, k).toBeDefined();
      expect(v.length).toBeGreaterThanOrEqual(1);
      expect(v.length).toBeLessThanOrEqual(3);
      for (const s of v) expect(s).not.toMatch(/[–—]|quietly|seamlessly|silently|effortlessly/);
    }
    expect(copy.COPY.timer_running.length).toBe(3);
    expect(copy.COPY.photo_waiting.length).toBe(3);
    expect(copy.COPY.first_open).toContain(copy.line("first_open") as never);
  });
});

describe("cosmetics", () => {
  it("refuses to buy when broke", async () => {
    const u = await newUser();
    const res = await req(u, "/api/cosmetics/hat_crown/buy", "POST");
    expect(res.status).toBe(402);
    const list = await (await req(u, "/api/cosmetics")).json();
    expect(list.items.find((x: { id: string }) => x.id === "hat_crown").owned).toBe(false);
  });

  it("buys with enough money, debits, refuses a second buy", async () => {
    const u = await newUser();
    await shim.creditWallet(u.id, 10, "meal", null);
    const res = await req(u, "/api/cosmetics/hat_chef/buy", "POST");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.balance).toBe(6);
    expect(typeof j.line).toBe("string");
    expect((await req(u, "/api/cosmetics/hat_chef/buy", "POST")).status).toBe(409);
  });

  it("wears one item per slot", async () => {
    const u = await newUser();
    await shim.creditWallet(u.id, 50, "meal", null);
    for (const id of ["hat_chef", "hat_beanie", "acc_apron"]) {
      expect((await req(u, `/api/cosmetics/${id}/buy`, "POST")).status).toBe(200);
    }
    await req(u, "/api/cosmetics/hat_chef/wear", "POST");
    await req(u, "/api/cosmetics/acc_apron/wear", "POST");
    const j = await (await req(u, "/api/cosmetics/hat_beanie/wear", "POST")).json();
    const worn = j.items.filter((x: { worn: boolean }) => x.worn).map((x: { id: string }) => x.id).sort();
    expect(worn).toEqual(["acc_apron", "hat_beanie"]);
    const after = await (await req(u, "/api/cosmetics/hat_beanie/unwear", "POST")).json();
    expect(after.items.filter((x: { worn: boolean }) => x.worn).map((x: { id: string }) => x.id)).toEqual(["acc_apron"]);
  });

  it("refuses to wear an item you do not own", async () => {
    const u = await newUser();
    expect((await req(u, "/api/cosmetics/hat_chef/wear", "POST")).status).toBe(403);
  });
});

describe("friends", () => {
  it("adds symmetrically, refuses self and duplicates", async () => {
    const a = await newUser();
    const b = await newUser();
    db.prepare("UPDATE account SET pet_name = 'mochi', growth_stage = 2 WHERE id = ?").run(b.id);
    await shim.creditWallet(b.id, 12.5, "meal", null);
    await shim.creditWallet(b.id, 3, "cosmetic", null); // not a meal, not counted

    expect((await req(a, "/api/friends/add", "POST", { code: a.code })).status).toBe(400);
    expect((await req(a, "/api/friends/add", "POST", { code: "NOPE99" })).status).toBe(404);
    expect((await req(a, "/api/friends/add", "POST", { code: b.code.toLowerCase() })).status).toBe(200);
    expect((await req(b, "/api/friends/add", "POST", { code: a.code })).status).toBe(409);

    const fa = (await (await req(a, "/api/friends")).json()).friends;
    const fb = (await (await req(b, "/api/friends")).json()).friends;
    expect(fa).toEqual([{ pet_name: "mochi", growth_stage: 2, week_saved: 12.5 }]);
    expect(fb).toHaveLength(1);
  });
});

describe("signup", () => {
  beforeEach(() => signup.resetSignupRateLimit());

  it("validates and normalises", async () => {
    const ip = { "x-forwarded-for": "10.0.0.1" };
    expect((await req(null, "/api/signup", "POST", {}, ip)).status).toBe(400);
    expect((await req(null, "/api/signup", "POST", { email: "nope" }, ip)).status).toBe(400);
    expect((await req(null, "/api/signup", "POST", { phone: "123" }, ip)).status).toBe(400);
    const ok = await req(null, "/api/signup", "POST", { phone: "(519) 555-0123", ref: "ABC123", source: "reel1" }, ip);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect((await req(null, "/api/signup", "POST", { email: " Me@Example.com " }, ip)).status).toBe(200);
    const rows = db.prepare("SELECT email, phone, referral_code FROM signup ORDER BY id").all();
    expect(rows).toEqual([
      { email: null, phone: "+15195550123", referral_code: "ABC123" },
      { email: "me@example.com", phone: null, referral_code: null },
    ]);
  });

  it("sends CORS headers for the landing page only", async () => {
    const ok = await req(null, "/api/signup", "OPTIONS", undefined, { origin: "https://chungi.ugmi.ca", "access-control-request-method": "POST" });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://chungi.ugmi.ca");
    const local = await req(null, "/api/signup", "OPTIONS", undefined, { origin: "http://localhost:5173", "access-control-request-method": "POST" });
    expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const bad = await req(null, "/api/signup", "OPTIONS", undefined, { origin: "https://evil.example", "access-control-request-method": "POST" });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits to 10 per hour per IP", async () => {
    const ip = { "x-forwarded-for": "10.0.0.2" };
    for (let i = 0; i < 10; i++) {
      expect((await req(null, "/api/signup", "POST", { email: `r${i}@x.co` }, ip)).status).toBe(200);
    }
    expect((await req(null, "/api/signup", "POST", { email: "r10@x.co" }, ip)).status).toBe(429);
    expect((await req(null, "/api/signup", "POST", { email: "other@x.co" }, { "x-forwarded-for": "10.0.0.3" })).status).toBe(200);
  });

  it("export is 404 without ADMIN_TOKEN and needs the header when set", async () => {
    delete process.env.ADMIN_TOKEN;
    expect((await req(null, "/api/signup/export.csv")).status).toBe(404);
    process.env.ADMIN_TOKEN = "test-admin";
    expect((await req(null, "/api/signup/export.csv")).status).toBe(403);
    expect((await req(null, "/api/signup/export.csv", "GET", undefined, { "x-admin-token": "wrong" })).status).toBe(403);
    const res = await req(null, "/api/signup/export.csv", "GET", undefined, { "x-admin-token": "test-admin" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.split("\n")[0]).toBe("id,email,phone,referral_code,source,created_at");
    expect(text).toContain("+15195550123");
    delete process.env.ADMIN_TOKEN;
  });
});

describe("checkin", () => {
  it("keeps one row per day and flags ordering", async () => {
    const u = await newUser();
    expect((await (await req(u, "/api/checkin/today")).json()).answer).toBeNull();
    expect((await req(u, "/api/checkin", "POST", { answer: "maybe" })).status).toBe(400);
    const c1 = await (await req(u, "/api/checkin", "POST", { answer: "cooking" })).json();
    expect(c1.prompt_comparison).toBe(false);
    const c2 = await (await req(u, "/api/checkin", "POST", { answer: "ordering" })).json();
    expect(c2.prompt_comparison).toBe(true);
    const n = db.prepare("SELECT COUNT(*) AS n FROM checkin WHERE account_id = ?").get(u.id) as { n: number };
    expect(n.n).toBe(1);
    expect((await (await req(u, "/api/checkin/today")).json()).answer).toBe("ordering");
  });
});

describe("timer", () => {
  it("starts, stops, and closes the previous open session", async () => {
    const u = await newUser();
    const s1 = await (await req(u, "/api/timer/start", "POST")).json();
    const s2 = await (await req(u, "/api/timer/start", "POST")).json();
    expect(s2.id).not.toBe(s1.id);
    const open = db.prepare("SELECT COUNT(*) AS n FROM timer_session WHERE account_id = ? AND stopped_at IS NULL").get(u.id) as { n: number };
    expect(open.n).toBe(1);

    db.prepare("UPDATE timer_session SET started_at = ? WHERE id = ?").run(new Date(Date.now() - 90_000).toISOString(), s2.id);
    const stop = await (await req(u, "/api/timer/stop", "POST", { id: s2.id })).json();
    expect(stop.seconds).toBeGreaterThanOrEqual(89);
    expect(stop.seconds).toBeLessThanOrEqual(92);

    const other = await newUser();
    expect((await req(other, "/api/timer/stop", "POST", { id: s2.id })).status).toBe(404);
  });

  it("closeTimerSession attaches a meal", async () => {
    const u = await newUser();
    const s = await (await req(u, "/api/timer/start", "POST")).json();
    const meal = db.prepare("INSERT INTO meal (account_id, takeout_price, saved) VALUES (?, 18, 14)").run(u.id);
    const secs = timer.closeTimerSession(s.id, Number(meal.lastInsertRowid));
    expect(secs).toBeGreaterThanOrEqual(0);
    const row = db.prepare("SELECT meal_id, stopped_at FROM timer_session WHERE id = ?").get(s.id) as { meal_id: number; stopped_at: string };
    expect(row.meal_id).toBe(Number(meal.lastInsertRowid));
    expect(row.stopped_at).not.toBeNull();
    expect(timer.closeTimerSession(999999, 1)).toBeNull();
  });
});
