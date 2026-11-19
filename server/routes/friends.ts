// Friends: added by referral code, symmetric, one row per pair stored as
// (smaller id, larger id). Reads accept rows in either order in case another
// owner inserts them differently.
import type { Hono } from "hono";
import { db } from "../db.ts";
import { config } from "../config.ts";
import { getAccount } from "./_a2shim.ts";
import { weekStartSql } from "./_a2time.ts";

type FriendRow = { id: number; pet_name: string | null; growth_stage: number; week_saved: number };

export function areFriends(x: number, y: number): boolean {
  return !!db.prepare("SELECT 1 FROM friendship WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)").get(x, y, y, x);
}

// Creates the friendship. Returns an error code or null on success.
export function addFriend(me: number, other: number): "self" | "duplicate" | null {
  if (me === other) return "self";
  if (areFriends(me, other)) return "duplicate";
  db.prepare("INSERT INTO friendship (a, b) VALUES (?, ?)").run(Math.min(me, other), Math.max(me, other));
  return null;
}

export function listFriends(me: number): FriendRow[] {
  const since = weekStartSql();
  const rows = db.prepare(
    `SELECT acc.id, acc.pet_name, acc.growth_stage,
            COALESCE((SELECT SUM(w.amount) FROM wallet_ledger w
                      WHERE w.account_id = acc.id AND w.kind = 'meal' AND w.created_at >= ?), 0) AS week_saved
       FROM account acc
      WHERE acc.id IN (SELECT b FROM friendship WHERE a = ? UNION SELECT a FROM friendship WHERE b = ?)
      ORDER BY week_saved DESC, acc.id`,
  ).all(since, me, me) as FriendRow[];
  return rows.map(r => ({ ...r, week_saved: Math.round(r.week_saved * 100) / 100 }));
}

export function register(app: Hono) {
  app.get("/api/friends", async c => {
    const acct = await getAccount(c);
    const friends = listFriends(acct.id).map(({ id: _id, ...rest }) => rest);
    return c.json({ friends });
  });

  app.get("/api/friends/code", async c => {
    const acct = await getAccount(c);
    const url = `${config.landingUrl}/?ref=${encodeURIComponent(acct.referral_code)}`;
    return c.json({ code: acct.referral_code, url });
  });

  app.post("/api/friends/add", async c => {
    const acct = await getAccount(c);
    const body = await c.req.json().catch(() => ({})) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code) return c.json({ error: "missing_code" }, 400);
    const other = db.prepare("SELECT id FROM account WHERE upper(referral_code) = ?").get(code) as { id: number } | undefined;
    if (!other) return c.json({ error: "unknown_code" }, 404);
    const err = addFriend(acct.id, other.id);
    if (err === "self") return c.json({ error: "self" }, 400);
    if (err === "duplicate") return c.json({ error: "already_friends" }, 409);
    return c.json({ ok: true });
  });
}
