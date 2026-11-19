// Adapter from the A2 route signatures to the A1 account and wallet modules.
import { getAccount } from "./account.ts";
import { getBalance, creditWallet as credit, debitWallet as debit } from "./wallet.ts";
export { getAccount };
export const walletBalance = getBalance;
export function creditWallet(accountId: number, amount: number, kind: string, refId: number | string | null): void {
  credit(accountId, amount, kind, refId as number | null);
}
export function debitWallet(accountId: number, amount: number, kind: string, refId: number | string | null): void {
  const r = debit(accountId, amount, kind, refId as number | null);
  if (!r.ok) throw new Error("insufficient_balance");
}
