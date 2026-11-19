// Device-bound accounts. No login: the first /api request without a valid
// `chungi` cookie creates an account and sets the cookie. Other route owners
// call getAccount(c) to get the current account row.
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes, randomInt } from "node:crypto";
import { db } from "../db.ts";
import { config } from "../config.ts";
import { getBalance } from "./wallet.ts";

export type Account = {
  id: number; token: string; pet_name: string | null; growth_stage: number;
  phone: string | null; email: string | null; referral_code: string;
  referred_by: number | null; created_at: string;
};

declare module "hono" {
  interface ContextVariableMap { account: Account }
}

export const COOKIE_NAME = "chungi";
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // 400 days, the browser maximum
const TOKEN_RE = /^[0-9a-f]{64}$/;
// No 0/O, 1/I/L, so a code read aloud or typed from a story is not misread.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const DEFAULT_SPEND = 18;
const SOURCES = ["uber_eats", "skip", "campus", "boba", "other"];

function newReferralCode(): string {
  for (let tries = 0; tries < 20; tries++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!db.prepare("SELECT 1 FROM account WHERE referral_code = ?").get(code)) return code;
  }
  throw new Error("could not find a free referral code");
}

function accountByToken(token: string | undefined): Account | undefined {
  if (!token || !TOKEN_RE.test(token)) return undefined;
  return db.prepare("SELECT * FROM account WHERE token = ?").get(token) as Account | undefined;
}

export function accountById(id: number): Account | undefined {
  return db.prepare("SELECT * FROM account WHERE id = ?").get(id) as Account | undefined;
}

export function accountByReferralCode(code: string | null | undefined): Account | undefined {
  if (!code || typeof code !== "string") return undefined;
  return db.prepare("SELECT * FROM account WHERE referral_code = ?")
    .get(code.trim().toUpperCase()) as Account | undefined;
}

function createAccount(c: Context, ref: string | null): Account {
  const token = randomBytes(32).toString("hex");
  const referrer = accountByReferralCode(ref);
  const res = db.prepare("INSERT INTO account (token, referral_code, referred_by) VALUES (?, ?, ?)")
    .run(token, newReferralCode(), referrer?.id ?? null);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true, sameSite: "Lax", path: "/", maxAge: COOKIE_MAX_AGE,
    secure: config.publicUrl.startsWith("https://"),
  });
  return accountById(Number(res.lastInsertRowid))!;
}

// Reads `ref` from the query string or, for JSON requests, from the body.
// Hono caches the parsed body, so the route handler can still read it.
async function readRef(c: Context): Promise<string | null> {
  const q = c.req.query("ref");
  if (q) return q;
  if ((c.req.header("content-type") ?? "").includes("application/json")) {
    try {
      const body = await c.req.json();
      if (body && typeof body.ref === "string") return body.ref;
    } catch { /* bad JSON is the route's problem, not ours */ }
  }
  return null;
}

// Returns the account for this request. The middleware normally sets it; if a
// route somehow runs without it, this resolves or creates one on the spot.
export function getAccount(c: Context): Account {
  const set = c.get("account");
  if (set) return set;
  const acct = accountByToken(getCookie(c, COOKIE_NAME)) ?? createAccount(c, c.req.query("ref") ?? null);
  c.set("account", acct);
  return acct;
}

export function getComparison(accountId: number): { usual_source: string | null; usual_spend: number; set: boolean } {
  const row = db.prepare("SELECT usual_source, usual_spend FROM comparison WHERE account_id = ?")
    .get(accountId) as { usual_source: string | null; usual_spend: number } | undefined;
  return row ? { ...row, set: true } : { usual_source: null, usual_spend: DEFAULT_SPEND, set: false };
}

export function referralUrl(code: string): string {
  const u = new URL(config.landingUrl);
  u.searchParams.set("ref", code);
  return u.toString();
}

function mePayload(acct: Account) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM meal WHERE account_id = ?").get(acct.id) as { n: number };
  const hasRecovery = Boolean(acct.phone || acct.email);
  return {
    id: acct.id,
    pet_name: acct.pet_name,
    growth_stage: acct.growth_stage,
    balance: getBalance(acct.id),
    comparison: getComparison(acct.id),
    referral_code: acct.referral_code,
    referral_url: referralUrl(acct.referral_code),
    referred_by: acct.referred_by,
    meal_count: n,
    phone: acct.phone,
    email: acct.email,
    // Offer a recovery key once, after the third meal.
    offer_recovery: n >= 3 && !hasRecovery,
    created_at: acct.created_at,
  };
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}

const cents = (n: number) => Math.round(n * 100) / 100;

function validMoney(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 200) return null;
  return cents(n);
}

export function register(app: Hono) {
  app.use("/api/*", async (c, next) => {
    let acct = accountByToken(getCookie(c, COOKIE_NAME));
    if (!acct) acct = createAccount(c, await readRef(c));
    c.set("account", acct);
    await next();
  });

  app.get("/api/me", c => c.json(mePayload(getAccount(c))));

  // Sets pet name and the optional recovery key. Validation is loose on
  // purpose: a phone is 7 to 15 digits once spaces and punctuation are gone,
  // an email is something@something.something.
  app.post("/api/me", async c => {
    const acct = getAccount(c);
    const b = await jsonBody(c);
    const sets: string[] = [];
    const vals: (string | null)[] = [];

    if ("pet_name" in b) {
      const name = typeof b.pet_name === "string" ? b.pet_name.trim() : "";
      if (name.length < 1 || name.length > 24) return c.json({ error: "pet_name must be 1 to 24 characters" }, 400);
      sets.push("pet_name = ?"); vals.push(name);
    }
    if ("phone" in b) {
      if (b.phone === null || b.phone === "") { sets.push("phone = ?"); vals.push(null); }
      else {
        const raw = String(b.phone).trim();
        const digits = raw.replace(/[\s().+-]/g, "");
        if (!/^\d{7,15}$/.test(digits)) return c.json({ error: "that phone number does not look right" }, 400);
        sets.push("phone = ?"); vals.push(raw.startsWith("+") ? "+" + digits : digits);
      }
    }
    if ("email" in b) {
      if (b.email === null || b.email === "") { sets.push("email = ?"); vals.push(null); }
      else {
        const email = String(b.email).trim().toLowerCase();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return c.json({ error: "that email does not look right" }, 400);
        }
        sets.push("email = ?"); vals.push(email);
      }
    }
    if (sets.length) {
      db.prepare(`UPDATE account SET ${sets.join(", ")} WHERE id = ?`).run(...vals, acct.id);
    }
    const fresh = accountById(acct.id)!;
    c.set("account", fresh);
    return c.json(mePayload(fresh));
  });

  // Onboarding answer: where the user usually orders and what it costs.
  app.post("/api/comparison", async c => {
    const acct = getAccount(c);
    const b = await jsonBody(c);
    const source = b.usual_source == null ? null : String(b.usual_source);
    if (source !== null && !SOURCES.includes(source)) {
      return c.json({ error: `usual_source must be one of ${SOURCES.join(", ")}` }, 400);
    }
    const spend = validMoney(b.usual_spend);
    if (spend === null) return c.json({ error: "usual_spend must be a number from 1 to 200" }, 400);
    db.prepare(`
      INSERT INTO comparison (account_id, usual_source, usual_spend, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT (account_id) DO UPDATE SET
        usual_source = excluded.usual_source, usual_spend = excluded.usual_spend, updated_at = excluded.updated_at
    `).run(acct.id, source, spend);
    return c.json({ comparison: getComparison(acct.id) });
  });

  // "What would tonight have been?" Logs the answer and moves usual_spend
  // toward it. Rolling rule: new = 0.7 * old + 0.3 * answer, rounded to the
  // cent. One odd night moves the price a little, three similar answers in a
  // row move it most of the way, and the number stays the user's own. With no
  // onboarding row yet, the first answer becomes the price outright.
  app.post("/api/comparison/answer", async c => {
    const acct = getAccount(c);
    const b = await jsonBody(c);
    const amount = validMoney(b.amount);
    if (amount === null) return c.json({ error: "amount must be a number from 1 to 200" }, 400);
    db.prepare("INSERT INTO comparison_answer (account_id, amount) VALUES (?, ?)").run(acct.id, amount);
    const cur = getComparison(acct.id);
    const next = cur.set ? cents(0.7 * cur.usual_spend + 0.3 * amount) : amount;
    db.prepare(`
      INSERT INTO comparison (account_id, usual_spend, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT (account_id) DO UPDATE SET usual_spend = excluded.usual_spend, updated_at = excluded.updated_at
    `).run(acct.id, next);
    return c.json({ comparison: getComparison(acct.id), answer: amount });
  });
}
