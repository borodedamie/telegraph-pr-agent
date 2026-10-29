import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { detectCutoffTriggers } from "./trigger.js";
import { IntelligenceClient } from "./x402.js";
import {
  commitLedgerRow,
  hasLedgerRow,
  LEDGER_FILE,
  type LedgerRow,
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
if (hasLedgerRow(existingLedger, prNumber, headSha)) {
  console.log(
    `idempotency: PR #${prNumber} @ ${headSha} already has a ledger row → skipping buy (zero spend).`,
  );
  process.exit(0);
}

const t = pastCutoff[0];
// No cutoff date in the query: the miner echoed it back as its own limit.
const purchase = await client.buy(
  "QUESTION_ANSWERING",
  `What notable API changes or upgrade risks does ${t.package}@${t.version} ` +
    `(released ${t.releaseDate}) introduce compared with earlier versions? Cite sources.`,
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
};

await commitLedgerRow(dir, row);
console.log(
  `ledger row committed: PR #${row.prNumber} ${row.intent} ${row.txHash}`,
);
console.log(
  `dashboard: https://raw.githubusercontent.com/${cfg.demoRepo}/ledger/${LEDGER_FILE}`,
);
