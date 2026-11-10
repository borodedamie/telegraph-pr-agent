import { z } from "zod";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttemptConflictError, checkMayPay, commitLedgerRow, LEDGER_FILE, preflight,
  type AttemptKey, type AttemptRow, type LedgerRow, type ModelProvenance, type ProposalRow } from "../../src/ledger.js";
import { AskFailedError, type IntelligenceClient, type Purchase } from "../../src/x402.js";
import { migrationPrompt, MIGRATION_MINER_ID } from "./miner-assessment";
import type { Dependency } from "./scan";

export type Ledger = { directory: string; runGit: (args: string[]) => Promise<void> };

export const openLedger = async (repository: string, token: string): Promise<Ledger> => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid ledger repository");
  const directory = mkdtempSync(join(tmpdir(), "telegraph-ledger-"));
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    GIT_CONFIG_KEY_1: "core.hooksPath", GIT_CONFIG_VALUE_1: "/dev/null" };
  const runGit = async (args: string[]): Promise<void> => {
    execFileSync("git", args, { cwd: directory, env, timeout: 60_000, stdio: "pipe" });
  };
  try {
    await runGit(["init", "-q"]);
    await runGit(["config", "user.name", "Telegraph dependency agent"]);
    await runGit(["config", "user.email", "telegraph-agent@users.noreply.github.com"]);
    await runGit(["remote", "add", "origin", `https://github.com/${repository}.git`]);
    let missing = false;
    try { await runGit(["ls-remote", "--exit-code", "--heads", "origin", "ledger"]); }
    catch (error) {
      if ((error as { status?: number }).status !== 2) throw error;
      missing = true;
    }
    if (missing) {
      await runGit(["symbolic-ref", "HEAD", "refs/heads/ledger"]);
      writeFileSync(join(directory, LEDGER_FILE), "");
      await runGit(["add", LEDGER_FILE]);
      await runGit(["commit", "-qm", "ledger: bootstrap"]);
      await runGit(["push", "origin", "ledger"]);
    }
    await runGit(["fetch", "origin", "ledger"]);
    await runGit(["checkout", "-B", "ledger", "origin/ledger"]);
    return { directory, runGit };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
};

const checkedLedger = (contents: string): string => {
  for (const line of contents.split("\n").filter((line) => line.trim())) {
    const row = JSON.parse(line);
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid ledger row; reconcile before payment");
  }
  return contents;
};

const savedPurchase = z.object({
  intent: z.string().min(1), minerId: z.string().min(1), minerName: z.string(),
  minerRank: z.number().nullable(), minerScore: z.number().nullable(),
  amountUsdc: z.number().finite().nonnegative(), txHash: z.string(),
  receiptHash: z.string(), signalHash: z.string(), answer: z.string(), result: z.unknown().optional(),
  status: z.literal("settled"), selectedBy: z.enum(["rank", "our_choice"]),
  network: z.string().min(1), chainId: z.number().int().positive(),
  usdcContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/), explorerBaseUrl: z.string(),
});

/** Reuse a paid answer or persist each payment stage before buying; legacy migrations retain uncertainty guards. */
export const purchaseAssessment = async (options: {
  ledger: Ledger; repository: string; baseSha: string; dependency: Dependency;
  provenance: ModelProvenance; intent: string; query: string; client: Pick<IntelligenceClient, "buy">;
  onPurchase: (purchase: Purchase) => void;
}): Promise<Purchase & { assessmentId: string; attemptId: string }> => {
  const { ledger, repository, baseSha, dependency, intent, query, client } = options;
  let assessmentId = createHash("sha256").update(JSON.stringify([
    repository, intent, dependency.ecosystem, dependency.source, dependency.package,
    dependency.currentVersion, dependency.targetVersion, query,
  ])).digest("hex");
  const key: AttemptKey = { repo: repository, headSha: baseSha,
    step: `assessment:${dependency.ecosystem}:${dependency.source}:${dependency.package}`, assessmentId, model: options.provenance };
  await ledger.runGit(["fetch", "origin", "ledger"]);
  await ledger.runGit(["checkout", "-B", "ledger", "origin/ledger"]);
  const ledgerPath = join(ledger.directory, LEDGER_FILE);
  if (!lstatSync(ledgerPath).isFile()) throw new Error("Ledger must be a regular file");
  const existing = checkedLedger(readFileSync(ledgerPath, "utf8"));
  const legacyId = assessmentId;
  const legacy = existing.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
    .find((row) => !row.kind && row.repo === repository && row.assessmentId === legacyId);
  const legacyCheck = preflight(existing, key);
  if (legacyCheck.action === "halt") throw new AttemptConflictError(legacyCheck.reason);
  // The legacy instruction prompt and the migration question are different billable requests.
  if (legacy?.minerId === MIGRATION_MINER_ID && !legacy.result && !legacy.answer.trim().startsWith("{")) {
    assessmentId = createHash("sha256").update(JSON.stringify([legacyId, "migration-v1", migrationPrompt(dependency)])).digest("hex");
    key.assessmentId = assessmentId;
  }
  const check = preflight(existing, key);
  if (check.action !== "buy") {
    if (check.action === "skip") {
      const row = existing.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
        .find((row) => !row.kind && row.repo === repository && row.assessmentId === assessmentId);
      if (typeof row?.attemptId !== "string" || !row.attemptId) throw new Error("Saved assessment needs attempt reconciliation");
      const purchase = { ...savedPurchase.parse(row), assessmentId, attemptId: row.attemptId };
      options.onPurchase(purchase);
      return purchase;
    }
    throw new AttemptConflictError(check.reason);
  }
  let attempt = check.nextAttempt;
  const attemptRow = (state: AttemptRow["state"], fields: Partial<AttemptRow> = {}): AttemptRow => ({
    ...key, kind: "attempt", attemptId: `${assessmentId}:${attempt}`, attempt, state,
    minerId: "", timestamp: new Date().toISOString(), ...fields,
  });
  const paid = await client.buy(intent, (minerId) => minerId === MIGRATION_MINER_ID && dependency.ecosystem === "npm" ? migrationPrompt(dependency) : query, async (event) => {
    if (event.state === "reserved" && event.minerId === MIGRATION_MINER_ID && dependency.ecosystem !== "npm") {
      throw new AskFailedError("Miner 7314 supports npm migrations only");
    }
    await commitLedgerRow(ledger.directory, (fresh) => {
      checkedLedger(fresh);
      if (assessmentId !== legacyId) {
        const prior = preflight(fresh, { ...key, assessmentId: legacyId });
        if (prior.action === "halt") throw new AttemptConflictError(prior.reason);
      }
      if (event.state === "reserved") {
        const now = preflight(fresh, key);
        if (now.action !== "buy") throw new AttemptConflictError(now.reason);
        attempt = now.nextAttempt;
      }
      if (event.state === "request_sent") checkMayPay(fresh, key, attemptRow(event.state).attemptId);
      return attemptRow(event.state, event);
    }, ledger);
  });
  const purchase = { ...paid, assessmentId, attemptId: attemptRow("delivered").attemptId };
  // Keep paid evidence available even if persisting it fails; request_sent then blocks another purchase.
  options.onPurchase(purchase);
  const row: LedgerRow = { ...purchase, model: options.provenance,
    evidenceIncomplete: !purchase.receiptHash || !purchase.signalHash || !purchase.txHash, repo: repository, headSha: baseSha, assessmentId,
    package: dependency.package, source: dependency.source, currentVersion: dependency.currentVersion,
    targetVersion: dependency.targetVersion, attemptId: attemptRow("delivered").attemptId,
    resultStatus: "unchecked", timestamp: new Date().toISOString() };
  await commitLedgerRow(ledger.directory, [row, attemptRow("delivered", {
    minerId: purchase.minerId, receiptHash: purchase.receiptHash,
  })], ledger);
  return purchase;
};

/** Append answer quality to the exact delivered attempt without rewriting payment evidence. */
export const markAssessmentResult = async (ledger: Ledger, attemptId: string, resultStatus: "useful" | "unusable" | "not_found", reason: string): Promise<void> => {
  await commitLedgerRow(ledger.directory, (fresh) => {
    const delivered = checkedLedger(fresh).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
      .reverse().find((row): row is AttemptRow => row.kind === "attempt" && row.attemptId === attemptId && row.state === "delivered");
    if (!delivered) throw new Error("Missing delivered assessment; cannot record answer quality");
    return delivered.resultStatus === resultStatus ? [] : { ...delivered, resultStatus,
      reason, timestamp: new Date().toISOString() };
  }, ledger);
};

/**
 * Record a published dependency PR against the paid answer it was built from, once per
 * PR, and mark that answer useful: it produced a valid, publishable upgrade.
 */
export const recordProposal = async (ledger: Ledger, proposal: Omit<ProposalRow, "kind" | "timestamp">): Promise<void> => {
  await commitLedgerRow(ledger.directory, (fresh) => {
    const recorded = checkedLedger(fresh).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
      .some((row) => row.kind === "proposal" && row.repo === proposal.repo && row.prNumber === proposal.prNumber);
    if (recorded) return [];
    const row: ProposalRow = { kind: "proposal", ...proposal, timestamp: new Date().toISOString() };
    return row;
  }, ledger);
  await markAssessmentResult(ledger, proposal.attemptId, "useful", `published PR #${proposal.prNumber}`);
};
