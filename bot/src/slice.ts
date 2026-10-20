// M1 vertical-slice runner: trigger → one settled QUESTION_ANSWERING buy → ledger row.
// Usage: pnpm exec tsx src/slice.ts <base-package.json> <head-package.json> <prNumber> <headSha>
// Requires bot/.env (or shell env) with all config values; spends real testnet USDC.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { detectCutoffTriggers } from "./trigger.js";
import { IntelligenceClient } from "./x402.js";
import { commitLedgerRow, LEDGER_FILE, type LedgerRow } from "./ledger.js";

const [baseFile, headFile, prNumberArg, headSha] = process.argv.slice(2);
if (!baseFile || !headFile || !prNumberArg || !headSha) {
  console.error("usage: tsx src/slice.ts <base-package.json> <head-package.json> <prNumber> <headSha>");
  process.exit(1);
}

const cfg = loadConfig();
const authUrl = `https://x-access-token:${cfg.ghPat}@github.com/${cfg.demoRepo}.git`;

const triggers = await detectCutoffTriggers(
  {
    basePackageJson: readFileSync(baseFile, "utf8"),
    headPackageJson: readFileSync(headFile, "utf8"),
  },
  cfg.modelCutoff
);
console.log("triggers:", JSON.stringify(triggers, null, 2));

const pastCutoff = triggers.filter((t) => t.status === "past-cutoff");
if (pastCutoff.length === 0) {
  console.log("AC-2: no past-cutoff trigger → zero spend, exiting without any purchase.");
  process.exit(0);
}

const client = new IntelligenceClient({
  nodeUrl: cfg.nodeUrl,
  evmPrivateKey: cfg.evmPrivateKey,
  maxPricePerCallUsdc: cfg.maxPricePerCallUsdc,
  budgetCapUsdc: cfg.budgetCapUsdc,
});

const t = pastCutoff[0];
const purchase = await client.buy("QUESTION_ANSWERING", {
  query:
    `Package ${t.package}@${t.version} was released ${t.releaseDate}, after the model cutoff ` +
    `${cfg.modelCutoff.toISOString()}. What notable API changes or upgrade risks should a maintainer ` +
    `know before merging a dependency bump to this version?`,
});
console.log("purchase:", JSON.stringify(purchase, null, 2));

const row: LedgerRow = {
  prNumber: Number(prNumberArg),
  headSha,
  intent: purchase.intent,
  minerId: purchase.minerId,
  minerName: purchase.minerName,
  amountUsdc: purchase.amountUsdc,
  txHash: purchase.txHash,
  answerPreview: purchase.answerPreview,
  timestamp: new Date().toISOString(),
  status: purchase.status,
};

// Work in a throwaway clone so the local working tree is never switched to the ledger branch.
const dir = mkdtempSync(join(tmpdir(), "ledger-clone-"));
try {
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", authUrl]);
  execFileSync("git", ["-C", dir, "fetch", "-q", "origin", "ledger"]);
} catch {
  console.log("ledger branch missing — bootstrapping empty ledger.jsonl");
  execFileSync("git", ["-C", dir, "symbolic-ref", "HEAD", "refs/heads/ledger"]);
  writeFileSync(join(dir, LEDGER_FILE), "");
  execFileSync("git", ["-C", dir, "add", LEDGER_FILE]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "ledger: bootstrap"]);
  execFileSync("git", ["-C", dir, "push", "-q", "origin", "ledger"]);
  execFileSync("git", ["-C", dir, "fetch", "-q", "origin", "ledger"]);
}

await commitLedgerRow(dir, row);
console.log(`ledger row committed: PR #${row.prNumber} ${row.intent} ${row.txHash}`);
console.log(`dashboard: https://raw.githubusercontent.com/${cfg.demoRepo}/ledger/${LEDGER_FILE}`);
