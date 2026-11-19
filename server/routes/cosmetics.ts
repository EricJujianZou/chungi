// Cosmetics shop: catalogue from data/cosmetics.json, ownership in owned_cosmetic.
// Bought with wallet money; one worn item per slot.
import type { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.ts";
import { line } from "../copy.ts";
import { getAccount, debitWallet, walletBalance } from "./_a2shim.ts";

export type Slot = "hat" | "accessory" | "background";
export type Cosmetic = { id: string; slot: Slot; name: string; price: number; art: string };

const here = dirname(fileURLToPath(import.meta.url));
export const CATALOGUE: Cosmetic[] = JSON.parse(
  readFileSync(join(here, "..", "..", "data", "cosmetics.json"), "utf8"),
);
const byId = new Map(CATALOGUE.map(x => [x.id, x]));

type Owned = { cosmetic_id: string; worn: number };

function ownedRows(accountId: number): Map<string, Owned> {
  const rows = db.prepare("SELECT cosmetic_id, worn FROM owned_cosmetic WHERE account_id = ?").all(accountId) as Owned[];
  return new Map(rows.map(r => [r.cosmetic_id, r]));
}

function listFor(accountId: number) {
  const owned = ownedRows(accountId);
  return {
    balance: walletBalance(accountId),
    items: CATALOGUE.map(x => ({
      ...x,
      owned: owned.has(x.id),
      worn: owned.get(x.id)?.worn === 1,
    })),
  };
}

export function register(app: Hono) {
  app.get("/api/cosmetics", async c => {
    const acct = await getAccount(c);
    return c.json(listFor(acct.id));
  });

  app.post("/api/cosmetics/:id/buy", async c => {
    const acct = await getAccount(c);
    const item = byId.get(c.req.param("id"));
    if (!item) return c.json({ error: "not_found" }, 404);
    if (ownedRows(acct.id).has(item.id)) return c.json({ error: "already_owned" }, 409);
    if (walletBalance(acct.id) < item.price) {
      return c.json({ error: "not_enough", balance: walletBalance(acct.id), price: item.price }, 402);
    }
    try {
      await debitWallet(acct.id, item.price, "cosmetic", item.id);
    } catch {
      return c.json({ error: "not_enough", balance: walletBalance(acct.id), price: item.price }, 402);
    }
    db.prepare("INSERT INTO owned_cosmetic (account_id, cosmetic_id) VALUES (?, ?)").run(acct.id, item.id);
    return c.json({ ok: true, line: line("cosmetic_bought"), ...listFor(acct.id) });
  });

  app.post("/api/cosmetics/:id/wear", async c => {
    const acct = await getAccount(c);
    const item = byId.get(c.req.param("id"));
    if (!item) return c.json({ error: "not_found" }, 404);
    if (!ownedRows(acct.id).has(item.id)) return c.json({ error: "not_owned" }, 403);
    const sameSlot = CATALOGUE.filter(x => x.slot === item.slot).map(x => x.id);
    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE owned_cosmetic SET worn = 0 WHERE account_id = ? AND cosmetic_id IN (${sameSlot.map(() => "?").join(",")})`,
      ).run(acct.id, ...sameSlot);
      db.prepare("UPDATE owned_cosmetic SET worn = 1 WHERE account_id = ? AND cosmetic_id = ?").run(acct.id, item.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return c.json({ ok: true, ...listFor(acct.id) });
  });

  app.post("/api/cosmetics/:id/unwear", async c => {
    const acct = await getAccount(c);
    const item = byId.get(c.req.param("id"));
    if (!item) return c.json({ error: "not_found" }, 404);
    db.prepare("UPDATE owned_cosmetic SET worn = 0 WHERE account_id = ? AND cosmetic_id = ?").run(acct.id, item.id);
    return c.json({ ok: true, ...listFor(acct.id) });
  });
}
