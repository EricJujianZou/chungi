// Wallet: a ledger of credits (meals) and debits (cosmetics). The balance is
// always the sum of the ledger, never a stored number, so it can be rebuilt.
import type { Hono } from "hono";
import { db } from "../db.ts";
import { getAccount } from "./account.ts";

export type LedgerRow = {
  id: number; amount: number; kind: string; ref_id: number | null; created_at: string;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function getBalance(accountId: number): number {
  const row = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_ledger WHERE account_id = ?"
  ).get(accountId) as { bal: number };
  return cents(row.bal);
}

// Adds money to the wallet. Amount must be zero or more. Returns the new balance.
export function creditWallet(accountId: number, amount: number, kind: string, refId: number | null = null): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("credit amount must be >= 0");
  db.prepare("INSERT INTO wallet_ledger (account_id, amount, kind, ref_id) VALUES (?, ?, ?, ?)")
    .run(accountId, cents(amount), kind, refId);
  return getBalance(accountId);
}

// Takes money out of the wallet. Refuses (ok: false, nothing written) when
// the balance is lower than the amount. The check and the insert are one SQL
// statement, so two purchases at once cannot both pass on the same balance.
export function debitWallet(
  accountId: number, amount: number, kind: string, refId: number | null = null,
): { ok: boolean; balance: number } {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("debit amount must be > 0");
  const amt = cents(amount);
  const res = db.prepare(`
    INSERT INTO wallet_ledger (account_id, amount, kind, ref_id)
    SELECT ?, ?, ?, ?
    WHERE (SELECT ROUND(COALESCE(SUM(amount), 0), 2) FROM wallet_ledger WHERE account_id = ?) >= ?
  `).run(accountId, -amt, kind, refId, accountId, amt);
  return { ok: Number(res.changes) === 1, balance: getBalance(accountId) };
}

export function getLedger(accountId: number): LedgerRow[] {
  return db.prepare(
    "SELECT id, amount, kind, ref_id, created_at FROM wallet_ledger WHERE account_id = ? ORDER BY id DESC"
  ).all(accountId) as LedgerRow[];
}

export function register(app: Hono) {
  app.get("/api/wallet", c => {
    const acct = getAccount(c);
    return c.json({ balance: getBalance(acct.id), ledger: getLedger(acct.id) });
  });
}
