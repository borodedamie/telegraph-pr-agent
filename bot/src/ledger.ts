import { execFile } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const LEDGER_FILE = "ledger.jsonl";
const LEDGER_BRANCH = "ledger";
const MAX_PUSH_ATTEMPTS = 3;

export interface ModelProvenance {
  provider: string;
  model: string;
  cutoff: string;
  sourceUrl: string;
  status: "provider-documented" | "team-assumed";
  configuredAt: string;
}

export interface LedgerRow {
  model?: ModelProvenance;
  evidenceIncomplete?: boolean;
  repo?: string;
  assessmentId?: string;
  package?: string;
  source?: string;
  currentVersion?: string;
  targetVersion?: string;
  prNumber?: number;
  headSha: string;
  intent: string;
  minerId: string;
  minerName: string;
  /** Null when the node gave the miner no rank or score for the intent (an unranked miner we chose). */
  minerRank: number | null;
  minerScore: number | null;
  amountUsdc: number;
  txHash: string;
  receiptHash: string;
  signalHash: string;
  answer: string;
  timestamp: string;
  status: "settled" | "failed";
  /** Who picked the miner: the leaderboard, or our PREFERRED_MINER_ID. Absent on rows written before 6 Nov 2026. */
  selectedBy?: "rank" | "our_choice";
  /** Links the purchase to the attempt that paid for it. Absent on pre-attempt rows. */
  attemptId?: string;
  /**
   * Whether the answer was any use (SPEC §4.4a), kept apart from payment status.
   * New rows start "unchecked"; a person sets the rest until something judges quality.
   * Absent on rows written before 5 Nov 2026.
   */
  resultStatus?: "unchecked" | "useful" | "unusable" | "not_found";
  // From the paid 402 option (SPEC §4.5). Absent on rows written before 5 Nov 2026.
  network?: string;
  chainId?: number;
  usdcContract?: string;
  explorerBaseUrl?: string;
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
  model?: ModelProvenance;
  /** Stable dependency/query identity for assessments made before a PR exists. */
  assessmentId?: string;
  repo: string;
  prNumber?: number;
  headSha: string;
  step: string;
}

export interface AttemptRow extends AttemptKey {
  resultStatus?: LedgerRow["resultStatus"];
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

export interface MergeRow {
  kind: "merge";
  repo: string;
  prNumber: number;
  headSha: string;
  mergeSha: string;
  receiptHash: string;
  mergedAt: string;
  timestamp: string;
}

/** A dependency PR opened from a paid answer; one per repo and PR number. */
export interface ProposalRow {
  kind: "proposal";
  repo: string;
  prNumber: number;
  prUrl: string;
  assessmentId: string;
  attemptId: string;
  receiptHash: string;
  ecosystem: string;
  package: string;
  source: string;
  currentVersion: string;
  targetVersion: string;
  timestamp: string;
}

/** A dependency PR closed without merging; its purchase stays spent (SPEC §4.3). */
export interface ClosedRow {
  kind: "closed";
  repo: string;
  prNumber: number;
  headSha: string;
  receiptHash: string;
  closedAt: string;
  timestamp: string;
}

export type LedgerEntry = LedgerRow | AttemptRow | MergeRow | ProposalRow | ClosedRow;

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
export function hasLedgerRow(existing: string, prNumber: number | undefined, headSha: string): boolean {
  if (prNumber === undefined) return false;
  for (const row of parseRows(existing)) {
    // kind undefined means a purchase row, which always has headSha.
    if (row.kind === undefined && row.prNumber === prNumber && (row as Partial<LedgerRow>).headSha === headSha) return true;
  }
  return false;
}

/** Thrown when the fresh ledger shows another run got there first; never retried. */
export class AttemptConflictError extends Error {}
/** Thrown when a purchase's receipt_hash is already on the ledger; never retried. */
export class DuplicateReceiptError extends Error {}

function receiptHashes(existing: string): Set<string> {
  const hashes = new Set<string>();
  for (const row of parseRows(existing)) {
    if (row.kind !== "attempt" && typeof row.receiptHash === "string" && row.receiptHash) hashes.add(row.receiptHash);
  }
  return hashes;
}

/** The latest row of each attempt for this key. */
function latestAttempts(existing: string, key: AttemptKey): AttemptRow[] {
  const latest = new Map<string, AttemptRow>();
  for (const row of parseRows(existing)) {
    if (row.kind !== "attempt") continue;
    const a = row as AttemptRow;
    if (a.repo === key.repo && a.step === key.step && (key.assessmentId
      ? a.assessmentId === key.assessmentId
      : a.assessmentId === undefined && a.prNumber === key.prNumber && a.headSha === key.headSha)) {
      latest.set(a.attemptId, a);
    }
  }
  return [...latest.values()];
}

const isOpen = (a: AttemptRow) => a.state === "request_sent" || a.state === "unknown_needs_reconciliation";

/** Decides, before any money moves, whether this key may be bought now. */
export function preflight(existing: string, key: AttemptKey): Preflight {
  // Pre-attempt purchase rows carry no repo or step; matching PR + SHA is the old rule.
  if (hasLedgerRow(existing, key.prNumber, key.headSha)) {
    return { action: "skip", reason: `PR #${key.prNumber} @ ${key.headSha} already has a purchase` };
  }
  const attempts = latestAttempts(existing, key);
  const open = attempts.filter(isOpen);
  if (open.length > 0) {
    return {
      action: "halt",
      reason:
        `payment outcome unknown for ${open.map((a) => `${a.attemptId} (${a.state})`).join(", ")}; ` +
        "check the wallet, escrow balance and signal before retrying",
    };
  }
  const delivered = attempts.find((a) => a.state === "delivered");
  if (delivered) return { action: "skip", reason: `attempt ${delivered.attemptId} already delivered` };
  return { action: "buy", nextAttempt: Math.max(0, ...attempts.map((a) => a.attempt)) + 1 };
}

/**
 * Run on the freshly fetched ledger right before recording request_sent: another run
 * for the same key may have started paying since this run's own check.
 */
export function checkMayPay(existing: string, key: AttemptKey, attemptId: string): void {
  if (hasLedgerRow(existing, key.prNumber, key.headSha)) {
    throw new AttemptConflictError(`PR #${key.prNumber} @ ${key.headSha} already has a purchase`);
  }
  const others = latestAttempts(existing, key).filter(
    (a) => a.attemptId !== attemptId && (a.state === "delivered" || isOpen(a))
  );
  if (others.length > 0) {
    throw new AttemptConflictError(
      `another run is paying or has paid: ${others.map((a) => `${a.attemptId} (${a.state})`).join(", ")}`
    );
  }
}

const describeRow = (r: LedgerEntry) =>
  "kind" in r && r.kind === "merge" ? `PR #${r.prNumber} merged ${r.mergeSha}` :
  "kind" in r && r.kind === "proposal" ? `PR #${r.prNumber} proposed ${r.package} ${r.targetVersion}` :
  "kind" in r && r.kind === "closed" ? `PR #${r.prNumber} closed unmerged` :
  "kind" in r && r.kind === "attempt"
    ? `${r.prNumber === undefined ? "assessment" : `PR #${r.prNumber}`} ${r.attemptId} ${r.state}`
    : `${r.prNumber === undefined ? "assessment" : `PR #${r.prNumber}`} ${(r as LedgerRow).intent} ${(r as LedgerRow).txHash}`;

type RowsToWrite = LedgerEntry | LedgerEntry[];

/**
 * Appends one row, or several in a single commit, and pushes. Pass a function to
 * build the rows from the freshly fetched ledger; it runs again on every push retry,
 * so a check it makes always sees the latest ledger. Anything it throws aborts.
 */
export async function commitLedgerRow(
  repoDir: string,
  rowsOrBuild: RowsToWrite | ((existing: string) => RowsToWrite),
  deps: LedgerDeps = {}
): Promise<void> {
  const runGit =
    deps.runGit ??
    ((args: string[]) => execFileAsync("git", args, { cwd: repoDir }).then(() => undefined));
  const ledgerPath = join(repoDir, LEDGER_FILE);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
    await runGit(["fetch", "origin", LEDGER_BRANCH]);
    await runGit(["checkout", "-B", LEDGER_BRANCH, `origin/${LEDGER_BRANCH}`]);
    const ledgerFile = lstatSync(ledgerPath, { throwIfNoEntry: false });
    if (ledgerFile && !ledgerFile.isFile()) {
      throw new Error("Ledger must be a regular file");
    }
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    const built = typeof rowsOrBuild === "function" ? rowsOrBuild(existing) : rowsOrBuild;
    const rows = Array.isArray(built) ? built : [built];
    if (rows.length === 0) return;
    // receipt_hash identifies a delivered purchase (SPEC §4.2): one row per receipt.
    const recorded = receiptHashes(existing);
    for (const r of rows) {
      if (!("kind" in r) && r.receiptHash && recorded.has(r.receiptHash)) {
        throw new DuplicateReceiptError(`receipt ${r.receiptHash} is already on the ledger`);
      }
    }
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
