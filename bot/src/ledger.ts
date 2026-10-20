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
  amountUsdc: number;
  txHash: string;
  answerPreview: string;
  timestamp: string;
  status: "settled" | "failed";
}

export interface LedgerDeps {
  runGit?: (args: string[]) => Promise<void>;
}

export function appendLedgerRow(existing: string, row: LedgerRow): string {
  return `${existing}${JSON.stringify(row)}\n`;
}

export async function commitLedgerRow(
  repoDir: string,
  row: LedgerRow,
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
    const existing = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    writeFileSync(ledgerPath, appendLedgerRow(existing, row));
    await runGit(["add", LEDGER_FILE]);
    await runGit(["commit", "-m", `ledger: PR #${row.prNumber} ${row.intent} ${row.txHash}`]);
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
