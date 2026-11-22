// The fix-stage gate (SPEC §2.9, decision 19 Nov 2026): can a Telegraph CODE_GENERATION_GENERAL
// miner migrate a real file, using our paid "what changed" answer, so the repository's own
// typecheck and tests pass? Two steps, kept apart on purpose:
//
//   buy    pays the code miner ATTEMPTS times for one file and saves each returned file.
//          Needs TELEGRAPH_EVM_PRIVATE_KEY. Never runs anything the miner returned.
//   check  copies the fixture once per saved file, swaps the file in and runs install,
//          typecheck and tests with an empty environment: no key, no token. Read the saved
//          files first; they are untrusted code.
//
// Run from bot/ (esbuild is already a pinned dev dependency):
//   npx esbuild scripts/codegen-gate.ts --bundle --platform=node --format=cjs --outfile=/tmp/codegen-gate.cjs
//   TELEGRAPH_EVM_PRIVATE_KEY=0x… node /tmp/codegen-gate.cjs buy
//   node /tmp/codegen-gate.cjs check
//
// Settings (env): FIXTURE_DIR (checkout of the fixture's paid zod PR branch), FIXTURE_REPO
// (owner/name, for its ledger), FILE (default src/user.ts), ATTEMPTS (default 3), OUT_DIR.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationFindings } from "../src/miner-assessment.js";
import { IntelligenceClient } from "../src/x402.js";

const CODE_MINER_ID = "1900999002"; // CodeWire, the only live code-writing CODE_GENERATION_GENERAL miner on 22 Nov
const INTENT = "CODE_GENERATION_GENERAL";
const MAX_QUERY_CHARS = 11_000; // the miner accepts at most 12,000

const fixtureDir = process.env.FIXTURE_DIR ?? "";
const file = process.env.FILE ?? "src/user.ts";
const outDir = process.env.OUT_DIR ?? "gate-results";
const attempts = Number(process.env.ATTEMPTS ?? "3");
if (!fixtureDir || !existsSync(join(fixtureDir, file))) throw new Error(`Set FIXTURE_DIR to a checkout containing ${file}`);
if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) throw new Error("ATTEMPTS must be 1 to 3");

type Row = Record<string, unknown>;

/** The fixture's paid zod answer, from its public ledger: the material input to every patch request. */
const paidChanges = async () => {
  const repo = process.env.FIXTURE_REPO ?? "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Set FIXTURE_REPO to owner/name");
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/ledger/ledger.jsonl`);
  if (!response.ok) throw new Error(`Ledger read failed: HTTP ${response.status}`);
  const purchase = (await response.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Row)
    .reverse()
    .find((row) => !row.kind && row.status === "settled" && row.package === "zod" && row.result);
  if (!purchase) throw new Error(`No settled zod purchase with a structured answer on ${repo}'s ledger`);
  const dependency = {
    ecosystem: "npm" as const, package: "zod", source: String(purchase.source), declared: "",
    currentVersion: String(purchase.currentVersion), targetVersion: String(purchase.targetVersion),
  };
  const [finding] = migrationFindings(purchase.result, [dependency]);
  if (!finding?.changes?.length) throw new Error("The paid answer lists no documented changes");
  return { finding, receiptHash: String(purchase.receiptHash) };
};

/** The request: the file, then the documented changes most likely to matter to it, within the size limit. */
const patchRequest = (source: string, finding: Awaited<ReturnType<typeof paidChanges>>["finding"]) => {
  const head = [
    `Migrate this TypeScript file from zod ${finding.currentVersion} to zod ${finding.targetVersion}.`,
    "Keep every export, type, behaviour and error message exactly the same, and use only APIs that exist in the new version.",
    "Return the complete updated file in one fenced code block and nothing else.",
    "",
    `File ${file}:`,
    "```ts",
    source.trimEnd(),
    "```",
    "",
    `Documented changes between these versions, from the release notes:`,
  ].join("\n");
  const words = new Set(source.match(/[A-Za-z_$][\w$]*/g) ?? []);
  // ponytail: relevance is "mentions a name used in the file"; good enough for one file.
  const mentions = (text: string) => (text.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((word) => words.has(word) && word.length > 2).length;
  const items = [...finding.changes!]
    .sort((a, b) => mentions(`${b.change} ${b.migration ?? ""}`) - mentions(`${a.change} ${a.migration ?? ""}`))
    .map((change) => `- [${change.kind}] ${change.version}: ${change.change}${change.migration ? ` Migration: ${change.migration}` : ""}`);
  let request = head;
  for (const item of items) {
    if (request.length + item.length + 1 > MAX_QUERY_CHARS) break;
    request += `\n${item}`;
  }
  return request;
};

/** The single fenced block the miner promises; anything else is not a usable patch. */
const fencedFile = (answer: string): string | null => {
  const blocks = [...answer.matchAll(/```[\w-]*\n([\s\S]*?)```/g)];
  return blocks.length === 1 ? blocks[0][1] : null;
};

const buy = async () => {
  const key = process.env.TELEGRAPH_EVM_PRIVATE_KEY ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Set TELEGRAPH_EVM_PRIVATE_KEY");
  const { finding, receiptHash } = await paidChanges();
  const request = patchRequest(readFileSync(join(fixtureDir, file), "utf8"), finding);
  const client = new IntelligenceClient({
    nodeUrl: "https://devnode.telegraphprotocol.com",
    evmPrivateKey: key as `0x${string}`,
    chainId: 11155111,
    usdcAddress: "0xcc194e1a843B658526D0D5C431f670028582Ae17",
    preferredMinerId: CODE_MINER_ID,
    maxPricePerCallUsdc: 0.02,
    budgetCapUsdc: 0.02 * attempts,
  });
  const run = join(outDir, new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "request.txt"), request);
  const results = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Only the code miner may be paid: the client falls through to other ranked miners on failure,
    // and the rest of this intent are data feeds, so refuse before any other miner is quoted.
    const purchase = await client.buy(INTENT, (minerId) => {
      if (minerId !== CODE_MINER_ID) throw new Error(`Refusing to ask miner ${minerId}: only ${CODE_MINER_ID} writes code`);
      return request;
    });
    const code = fencedFile(purchase.answer);
    const dir = join(run, `attempt-${attempt}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "answer.txt"), purchase.answer);
    if (code) writeFileSync(join(dir, "file.ts"), code);
    const result = {
      attempt, usable: Boolean(code), amountUsdc: purchase.amountUsdc, minerId: purchase.minerId,
      receiptHash: purchase.receiptHash, signalHash: purchase.signalHash, txHash: purchase.txHash || null,
      rail: purchase.rail ?? "exact",
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  writeFileSync(join(run, "buy.json"), JSON.stringify({ file, qaReceiptHash: receiptHash, requestChars: request.length, results }, null, 2));
  console.log(`Saved to ${run}. Read each attempt-*/file.ts before running check.`);
};

const sh = (cwd: string, command: string, args: string[]) => {
  try {
    // Untrusted code runs here: an empty environment apart from PATH and a throwaway HOME.
    execFileSync(command, args, { cwd, stdio: "pipe", encoding: "utf8", timeout: 300_000, env: { PATH: process.env.PATH ?? "", HOME: cwd } });
    return { ok: true, output: "" };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}`.slice(-4000) || failed.message };
  }
};

const check = () => {
  const runs = existsSync(outDir) ? readdirSync(outDir).sort() : [];
  if (!runs.length) throw new Error(`No runs in ${outDir}; run buy first`);
  const run = join(outDir, runs.at(-1)!);
  const results = [];
  for (const attempt of readdirSync(run).filter((name) => name.startsWith("attempt-")).sort()) {
    const patched = join(run, attempt, "file.ts");
    if (!existsSync(patched)) {
      results.push({ attempt, passed: false, stage: "no single code block in the answer" });
      continue;
    }
    const copy = mkdtempSync(join(tmpdir(), "codegen-gate-"));
    cpSync(fixtureDir, copy, { recursive: true, filter: (path) => !/\/(node_modules|\.git)(\/|$)/.test(path) });
    cpSync(patched, join(copy, file));
    let stage = "passed";
    let output = "";
    for (const [name, args] of [["install", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]], ["typecheck", ["run", "typecheck"]], ["test", ["test"]]] as const) {
      const step = sh(copy, "npm", [...args]);
      if (!step.ok) {
        stage = `${name} failed`;
        output = step.output;
        break;
      }
    }
    writeFileSync(join(run, attempt, "check.txt"), `${stage}\n\n${output}`);
    results.push({ attempt, passed: stage === "passed", stage });
    rmSync(copy, { recursive: true, force: true });
  }
  writeFileSync(join(run, "check.json"), JSON.stringify(results, null, 2));
  console.table(results);
  console.log(results.some((result) => result.passed) ? "GATE PASSED: build the fix stage" : "GATE FAILED: keep the call-site report");
};

const step = process.argv[2];
if (step === "buy") buy().catch((error) => { console.error(error); process.exit(1); });
else if (step === "check") check();
else throw new Error("Usage: codegen-gate.cjs buy|check");
