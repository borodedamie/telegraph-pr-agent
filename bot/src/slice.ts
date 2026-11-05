import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { detectCutoffTriggers } from "./trigger.js";
import { IntelligenceClient } from "./x402.js";
import {
  AttemptConflictError,
  type AttemptKey,
  type AttemptRow,
  checkMayPay,
  commitLedgerRow,
  DuplicateReceiptError,
  LEDGER_FILE,
  type LedgerRow,
  preflight,
} from "./ledger.js";

const [baseFile, headFile, prNumberArg, headSha] = process.argv.slice(2);
if (!baseFile || !headFile || !prNumberArg || !headSha) {
  console.error(
    "usage: tsx src/slice.ts <base-package.json> <head-package.json> <prNumber> <headSha>",
  );
  process.exit(1);
}

const cfg = loadConfig();
const authUrl = `https://x-access-token:${cfg.ghPat}@github.com/${cfg.demoRepo}.git`;

const triggers = await detectCutoffTriggers(
  {
    basePackageJson: readFileSync(baseFile, "utf8"),
    headPackageJson: readFileSync(headFile, "utf8"),
  },
  cfg.modelCutoff,
);
console.log("triggers:", JSON.stringify(triggers, null, 2));

const pastCutoff = triggers.filter((t) => t.status === "past-cutoff");
if (pastCutoff.length === 0) {
  console.log(
    "AC-2: no past-cutoff trigger → zero spend, exiting without any purchase.",
  );
  process.exit(0);
}

const client = new IntelligenceClient({
  nodeUrl: cfg.nodeUrl,
  evmPrivateKey: cfg.evmPrivateKey,
  chainId: cfg.chainId,
  usdcAddress: cfg.usdcAddress,
  maxPricePerCallUsdc: cfg.maxPricePerCallUsdc,
  budgetCapUsdc: cfg.budgetCapUsdc,
});

// Clone and read the ledger BEFORE spending: the guard's whole point is to
// detect an existing (pr, headSha) row without paying twice.
const prNumber = Number(prNumberArg);
const dir = mkdtempSync(join(tmpdir(), "ledger-clone-"));
try {
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", authUrl]);
  execFileSync("git", ["-C", dir, "fetch", "-q", "origin", "ledger"]);
  execFileSync("git", [
    "-C",
    dir,
    "checkout",
    "-q",
    "-B",
    "ledger",
    "origin/ledger",
  ]);
} catch {
  console.log("ledger branch missing — bootstrapping empty ledger.jsonl");
  execFileSync("git", ["-C", dir, "symbolic-ref", "HEAD", "refs/heads/ledger"]);
  writeFileSync(join(dir, LEDGER_FILE), "");
  execFileSync("git", ["-C", dir, "add", LEDGER_FILE]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "ledger: bootstrap"]);
  execFileSync("git", ["-C", dir, "push", "-q", "origin", "ledger"]);
  execFileSync("git", ["-C", dir, "fetch", "-q", "origin", "ledger"]);
}

const ledgerPath = join(dir, LEDGER_FILE);
const existingLedger = existsSync(ledgerPath)
  ? readFileSync(ledgerPath, "utf8")
  : "";
const key: AttemptKey = { repo: cfg.demoRepo, prNumber, headSha, step: "qa" };
const check = preflight(existingLedger, key);
if (check.action === "skip") {
  console.log(`idempotency: ${check.reason} → skipping buy (zero spend).`);
  process.exit(0);
}
if (check.action !== "buy") {
  console.error(`halted, not paying: ${check.reason}`);
  process.exit(1);
}

// Every stage is pushed before the bot moves on, so a crash or failed push
// leaves the attempt at its last recorded stage instead of erasing it.
let attempt = 0; // set from the fresh ledger as each attempt is reserved
const attemptRow = (state: AttemptRow["state"], fields: Partial<AttemptRow> = {}): AttemptRow => ({
  kind: "attempt",
  ...key,
  attemptId: `${key.repo}#${key.prNumber}@${key.headSha}:${key.step}:${attempt}`,
  attempt,
  state,
  minerId: "",
  timestamp: new Date().toISOString(),
  ...fields,
});

const t = pastCutoff[0];
// No cutoff date in the query: the miner echoed it back as its own limit.
const purchase = await client.buy(
  "QUESTION_ANSWERING_GENERAL",
  `What notable API changes or upgrade risks does ${t.package}@${t.version} ` +
    `(released ${t.releaseDate}) introduce compared with earlier versions? Cite sources.`,
  async (e) => {
    await commitLedgerRow(dir, (fresh) => {
      // Re-checked on the freshly fetched ledger: another run for the same key may
      // have started since this run read it. A push is rejected if someone else
      // pushed first, and the retry re-runs this check, so only one run can pay.
      if (e.state === "reserved") {
        const now = preflight(fresh, key);
        if (now.action !== "buy") throw new AttemptConflictError(now.reason);
        attempt = now.nextAttempt;
      }
      if (e.state === "request_sent") checkMayPay(fresh, key, attemptRow(e.state).attemptId);
      return attemptRow(e.state, e);
    });
  },
);
console.log("purchase:", JSON.stringify(purchase, null, 2));

const row: LedgerRow = {
  prNumber,
  headSha,
  intent: purchase.intent,
  minerId: purchase.minerId,
  minerName: purchase.minerName,
  minerRank: purchase.minerRank,
  minerScore: purchase.minerScore,
  amountUsdc: purchase.amountUsdc,
  txHash: purchase.txHash,
  receiptHash: purchase.receiptHash,
  signalHash: purchase.signalHash,
  answer: purchase.answer,
  timestamp: new Date().toISOString(),
  status: purchase.status,
  attemptId: attemptRow("delivered").attemptId,
  resultStatus: "unchecked",
  network: purchase.network,
  chainId: purchase.chainId,
  usdcContract: purchase.usdcContract,
  explorerBaseUrl: purchase.explorerBaseUrl,
};

try {
  await commitLedgerRow(dir, [
    row,
    attemptRow("delivered", { minerId: purchase.minerId, receiptHash: purchase.receiptHash }),
  ]);
} catch (err) {
  if (err instanceof DuplicateReceiptError) {
    console.error(`PAID, but not recorded again: ${err.message}. Check the ledger branch.`);
    throw err;
  }
  // The attempt stays at request_sent on the ledger, so the next run halts
  // instead of paying again. Print the purchase so a person can record it.
  console.error("PAID but the ledger push failed; record this row by hand:");
  console.error(JSON.stringify(row));
  throw err;
}
console.log(
  `ledger row committed: PR #${row.prNumber} ${row.intent} ${row.txHash}`,
);
console.log(
  `dashboard: https://raw.githubusercontent.com/${cfg.demoRepo}/ledger/${LEDGER_FILE}`,
);
