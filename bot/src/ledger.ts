import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const LEDGER_FILE = "ledger.jsonl";
const LEDGER_BRANCH = "ledger";
const MAX_PUSH_ATTEMPTS = 3;

export interface LedgerRow {
  prNumber: number;
  headSha: string;
  intent: string;
  minerId: string;
  minerName: string;
  minerRank: number;
  minerScore: number;
  amountUsdc: number;
  txHash: string;
  receiptHash: string;
  signalHash: string;
  answer: string;
  timestamp: string;
  status: "settled" | "failed";
  /** Links the purchase to the attempt that paid for it. Absent on pre-attempt rows. */
  attemptId?: string;
}

// One payment try moves reserved → quote_refused, or reserved → request_sent →
// delivered / failed_and_credited / failed_not_charged / unknown_needs_reconciliation.
// Each change of state appends a new row; the latest row for an attemptId wins.
export type AttemptState =
  | "reserved" // about to try; no money has moved
  | "quote_refused" // our price or budget limit refused the quote; nothing sent
  | "request_sent" // the paid request is going out; money may move
  | "delivered" // paid and answered; the purchase row holds the receipt
  | "failed_and_credited" // paid, then the call failed; amount credited to escrow
  | "failed_not_charged" // the node rejected the payment or reported it unsettled
  | "unknown_needs_reconciliation"; // sent, but no clear outcome; a person must check

export interface AttemptKey {
  repo: string;
  prNumber: number;
  headSha: string;
  step: string;
}

export interface AttemptRow extends AttemptKey {
  kind: "attempt";
  attemptId: string;
  attempt: number;
  state: AttemptState;
  minerId: string;
  quotedAmountUsdc?: number;
  receiptHash?: string;
  reason?: string;
  timestamp: string;
}

export type LedgerEntry = LedgerRow | AttemptRow;

export type Preflight =
  | { action: "buy"; nextAttempt: number }
  | { action: "skip" | "halt"; reason: string };

export interface LedgerDeps {
  runGit?: (args: string[]) => Promise<void>;
}

export function appendLedgerRow(existing: string, row: LedgerEntry): string {
  return `${existing}${JSON.stringify(row)}\n`;
}

function* parseRows(existing: string): Generator<Partial<LedgerEntry> & { kind?: string }> {
  for (const line of existing.split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // a malformed line never blocks the ledger
    }
  }
}

/** True when a purchase row (not an attempt row) exists for this PR and head SHA. */
export function hasLedgerRow(existing: string, prNumber: number, headSha: string): boolean {
  for (const row of parseRows(existing)) {
    if (row.kind !== "attempt" && row.prNumber === prNumber && row.headSha === headSha) return true;
  }
  return false;
}

/** Decides, before any money moves, whether this key may be bought now. */
export function preflight(existing: string, key: AttemptKey): Preflight {
  // Pre-attempt purchase rows carry no repo or step; matching PR + SHA is the old rule.
  if (hasLedgerRow(existing, key.prNumber, key.headSha)) {
    return { action: "skip", reason: `PR #${key.prNumber} @ ${key.headSha} already has a purchase` };
  }
  const latest = new Map<string, AttemptRow>();
  for (const row of parseRows(existing)) {
    if (row.kind !== "attempt") continue;
    const a = row as AttemptRow;
    if (a.repo === key.repo && a.prNumber === key.prNumber && a.headSha === key.headSha && a.step === key.step) {
      latest.set(a.attemptId, a);
    }
  }
  const attempts = [...latest.values()];
  const delivered = attempts.find((a) => a.state === "delivered");
  if (delivered) return { action: "skip", reason: `attempt ${delivered.attemptId} already delivered` };
  const open = attempts.filter((a) => a.state === "request_sent" || a.state === "unknown_needs_reconciliation");
  if (open.length > 0) {
    return {
      action: "halt",
      reason:
        `payment outcome unknown for ${open.map((a) => `${a.attemptId} (${a.state})`).join(", ")}; ` +
        "check the wallet, escrow balance and signal before retrying",
    };
  }
  return { action: "buy", nextAttempt: Math.max(0, ...attempts.map((a) => a.attempt)) + 1 };
}

const describeRow = (r: LedgerEntry) =>
  "kind" in r && r.kind === "attempt"
    ? `PR #${r.prNumber} ${r.attemptId} ${r.state}`
    : `PR #${r.prNumber} ${(r as LedgerRow).intent} ${(r as LedgerRow).txHash}`;

/** Appends one row, or several in a single commit, and pushes. */
export async function commitLedgerRow(
  repoDir: string,
  rowOrRows: LedgerEntry | LedgerEntry[],
  deps: LedgerDeps = {}
): Promise<void> {
  const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
  const runGit =
    deps.runGit ??
    ((args: string[]) => execFileAsync("git", args, { cwd: repoDir }).then(() => undefined));
  const ledgerPath = join(repoDir, LEDGER_FILE);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
    await runGit(["fetch", "origin", LEDGER_BRANCH]);
    await runGit(["checkout", "-B", LEDGER_BRANCH, `origin/${LEDGER_BRANCH}`]);
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    writeFileSync(ledgerPath, rows.reduce(appendLedgerRow, existing));
    await runGit(["add", LEDGER_FILE]);
    await runGit(["commit", "-m", `ledger: ${rows.map(describeRow).join("; ")}`]);
    try {
      await runGit(["push", "origin", LEDGER_BRANCH]);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `ledger push failed after ${MAX_PUSH_ATTEMPTS} attempts: ${String(lastError)}`
  );
}
