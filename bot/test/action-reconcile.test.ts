import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { checkReconciliation, reconcileAttempt, type Reconciliation } from "../actions/src/reconcile.js";
import { LEDGER_FILE, preflight, type AttemptRow } from "../src/ledger.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const TX = `0x${"a".repeat(64)}`;
const attempt = (state: AttemptRow["state"], extra: Partial<AttemptRow> = {}): AttemptRow => ({
  kind: "attempt", repo: "team/repo", headSha: "sha", step: "assessment:npm:package.json:zod", assessmentId: "assess",
  attemptId: "assess:1", attempt: 1, state, minerId: "7314", timestamp: "2026-11-10T00:00:00.000Z", ...extra,
});
const fixture = (...rows: AttemptRow[]) => {
  const directory = mkdtempSync(join(tmpdir(), "reconcile-"));
  directories.push(directory);
  const path = join(directory, LEDGER_FILE);
  let remote = rows.map((row) => `${JSON.stringify(row)}\n`).join("");
  const runGit = vi.fn(async (args: string[]) => {
    if (args[0] === "checkout") writeFileSync(path, remote);
    if (args[0] === "push") remote = readFileSync(path, "utf8");
  });
  return { ledger: { directory, runGit }, remote: () => remote,
    rows: () => remote.trim().split("\n").map((line) => JSON.parse(line)) };
};
const input = (outcome: Reconciliation["outcome"], extra: Partial<Reconciliation> = {}): Reconciliation =>
  ({ attemptId: "assess:1", outcome, note: "checked wallet and escrow", actor: "borodedamie", ...extra });

it("closes a stuck attempt with the outcome, note and who reconciled it, and then allows a new purchase", async () => {
  const f = fixture(attempt("reserved"), attempt("request_sent", { quotedAmountUsdc: 0.01 }));
  await reconcileAttempt(f.ledger, input("failed_and_credited"));
  const last = f.rows().at(-1);
  expect(last).toMatchObject({ kind: "attempt", attemptId: "assess:1", state: "failed_and_credited",
    reason: "reconciled: checked wallet and escrow", reconciledBy: "borodedamie", assessmentId: "assess" });
  expect(last.chargedAmountUsdc).toBeUndefined();
  const key = { repo: "team/repo", headSha: "sha", step: "assessment:npm:package.json:zod", assessmentId: "assess" };
  expect(preflight(f.remote(), key)).toEqual({ action: "buy", nextAttempt: 2 });
});

it("records failed_and_charged with its transaction and the quoted amount, or an amount given", async () => {
  const quoted = fixture(attempt("request_sent", { quotedAmountUsdc: 0.01 }), attempt("unknown_needs_reconciliation"));
  await reconcileAttempt(quoted.ledger, input("failed_and_charged", { txHash: TX }));
  expect(quoted.rows().at(-1)).toMatchObject({ state: "failed_and_charged", txHash: TX, chargedAmountUsdc: 0.01 });

  const given = fixture(attempt("request_sent", { quotedAmountUsdc: 0.01 }));
  await reconcileAttempt(given.ledger, input("failed_and_charged", { txHash: TX, amountUsdc: 0.05 }));
  expect(given.rows().at(-1)).toMatchObject({ chargedAmountUsdc: 0.05 });
});

it("refuses attempts that aren't stuck, and unknown attempts, without writing", async () => {
  for (const state of ["reserved", "delivered", "failed_not_charged"] as const) {
    const f = fixture(attempt(state));
    await expect(reconcileAttempt(f.ledger, input("failed_not_charged"))).rejects.toThrow(/can be reconciled/);
    expect(f.ledger.runGit.mock.calls.some(([args]) => args[0] === "push")).toBe(false);
  }
  const missing = fixture(attempt("request_sent"));
  await expect(reconcileAttempt(missing.ledger, input("failed_not_charged", { attemptId: "other:1" })))
    .rejects.toThrow("No attempt other:1");
});

it("adds nothing when the same reconciliation runs twice", async () => {
  const f = fixture(attempt("request_sent", { quotedAmountUsdc: 0.01 }));
  await reconcileAttempt(f.ledger, input("failed_not_charged"));
  await reconcileAttempt(f.ledger, input("failed_not_charged"));
  expect(f.rows()).toHaveLength(2);
});

it("needs a quote or an amount to record a charge", async () => {
  const f = fixture(attempt("request_sent"));
  await expect(reconcileAttempt(f.ledger, input("failed_and_charged", { txHash: TX }))).rejects.toThrow(/reconcile-amount-usdc/);
});

it("validates inputs before touching the ledger", () => {
  expect(() => checkReconciliation(input("failed_and_charged"))).toThrow(/needs reconcile-tx-hash/);
  expect(() => checkReconciliation(input("failed_and_credited", { txHash: "0x123" }))).toThrow(/32-byte/);
  expect(() => checkReconciliation(input("delivered" as Reconciliation["outcome"]))).toThrow(/must be one of/);
  expect(() => checkReconciliation(input("failed_not_charged", { note: " " }))).toThrow(/reconcile-note/);
  expect(() => checkReconciliation(input("failed_not_charged", { actor: "" }))).toThrow(/GITHUB_ACTOR/);
  expect(() => checkReconciliation(input("failed_and_charged", { txHash: TX, amountUsdc: -1 }))).toThrow(/positive/);
  expect(() => checkReconciliation(input("failed_and_charged", { txHash: TX }))).not.toThrow();
});
