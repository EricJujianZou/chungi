// Landing page signups (email and/or phone) and the admin CSV export.
// CORS is open only to the landing page (LANDING_URL plus SIGNUP_ORIGINS) and localhost, and only on POST /api/signup.
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";
import { db } from "../db.ts";

const LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

export function resetSignupRateLimit() {
  hits.clear();
}

function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return c.req.header("x-real-ip") ?? "unknown";
}

function overLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export function normaliseEmail(v: unknown): string | null | "invalid" {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "invalid";
  return e;
}

// Digits only with a leading +. 10 digits gets +1, 11 starting with 1 gets +.
export function normalisePhone(v: unknown): string | null | "invalid" {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (v.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return "invalid";
}

function short(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Leading = + - @ would run as a formula when opened in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) && !/^\+\d+$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function tokenOk(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function register(app: Hono) {
  app.use(
    "/api/signup",
    cors({
      origin: o => (o === new URL(config.landingUrl).origin || config.signupOrigins.includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o) ? o : null),
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.post("/api/signup", async c => {
    if (overLimit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return c.json({ error: "invalid" }, 400);
    const email = normaliseEmail(body.email);
    const phone = normalisePhone(body.phone);
    if (email === "invalid" || phone === "invalid" || (!email && !phone)) {
      return c.json({ error: "invalid" }, 400);
    }
    db.prepare("INSERT INTO signup (email, phone, referral_code, source) VALUES (?, ?, ?, ?)")
      .run(email, phone, short(body.ref, 32), short(body.source, 200));
    return c.json({ ok: true });
  });

  app.get("/api/signup/export.csv", c => {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) return c.notFound();
    if (!tokenOk(c.req.header("x-admin-token"), expected)) return c.json({ error: "forbidden" }, 403);
    const rows = db.prepare("SELECT id, email, phone, referral_code, source, created_at FROM signup ORDER BY id")
      .all() as Record<string, unknown>[];
    const cols = ["id", "email", "phone", "referral_code", "source", "created_at"];
    const out = [cols.join(","), ...rows.map(r => cols.map(k => csvCell(r[k])).join(","))].join("\n") + "\n";
    return c.body(out, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="chungi-signups.csv"',
    });
  });
}
