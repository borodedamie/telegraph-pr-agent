import * as core from "@actions/core";
import { execFileSync } from "node:child_process";
import { scanRepository } from "./scan";
import { IntelligenceClient } from "../../src/x402";
import { applyAssessment, assessmentPrompt } from "./assessment";
import { checkedOutBranch } from "./pull-request";

const MINER_ID = "";
const INTENT_ID = "QUESTION_ANSWERING_GENERAL";

const run = async (): Promise<void> => {
  try {
    if (!MINER_ID.trim()) throw new Error("Set MINER_ID in bot/actions/src/index.ts before running a purchase");
    const privateKey = process.env.TELEGRAPH_EVM_PRIVATE_KEY ?? "";
    const token = process.env.GITHUB_TOKEN ?? "";
    core.setSecret(privateKey);
    core.setSecret(token);
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Invalid TELEGRAPH_EVM_PRIVATE_KEY");
    if (!token) throw new Error("GITHUB_TOKEN is required to create dependency PRs");
    const repository = process.env.GITHUB_REPOSITORY ?? "";
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY must be owner/repo");
    const nodeUrl = core.getInput("node-url");
    if (new URL(nodeUrl).protocol !== "https:") throw new Error("node-url must use HTTPS");
    const maxPrice = Number(core.getInput("max-price-per-call-usdc"));
    const budget = Number(core.getInput("budget-cap-usdc"));
    if (![maxPrice, budget].every((amount) => Number.isFinite(amount) && amount > 0)) {
      throw new Error("max-price-per-call-usdc and budget-cap-usdc must be positive finite numbers");
    }
    const scan = await scanRepository();
    const baseBranch = checkedOutBranch(scan.root);
    const baseSha = execFileSync("git", ["-C", scan.root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    for (const skipped of scan.skipped) core.warning(`${skipped.project}: ${skipped.package}: ${skipped.reason}`);
    core.setOutput("pull-requests", "[]");
    if (scan.dependencies.length === 0) {
      core.setOutput("has-findings", "false");
      core.setOutput("message", "No resolved dependency versions found; no purchase made");
    } else {
      const client = new IntelligenceClient({ nodeUrl, evmPrivateKey: privateKey as `0x${string}`,
        maxPricePerCallUsdc: maxPrice, budgetCapUsdc: budget });
      const purchase = await client.buyFromMiner(INTENT_ID, assessmentPrompt(scan.dependencies), MINER_ID);
      // Preserve paid evidence in the output even if the answer cannot drive a safe update.
      core.setOutput("message", JSON.stringify(purchase));
      const urls = await applyAssessment({ root: scan.root, repository, baseBranch, baseSha, token,
        dependencies: scan.dependencies, purchase });
      core.setOutput("has-findings", String(urls.length > 0));
      core.setOutput("pull-requests", JSON.stringify(urls));
      for (const url of urls) core.info(`Dependency pull request: ${url}`);
    }
    core.setOutput("status", "success");
  } catch (error: unknown) {
    core.setOutput("status", "failed");
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
};

void run();
