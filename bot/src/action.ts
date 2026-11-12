import { readModelProvenance } from "./config.js";
import * as core from "@actions/core";
import { recordMerge, fetchMergedPr } from "./accounting.js";
import { readFileSync, rmSync } from "node:fs";
import { cutoffCandidates } from "./cutoff.js";
import { openLedger, purchaseAssessment, markAssessmentResult, recordProposal } from "./purchase.js";
import { execFileSync } from "node:child_process";
import { scanRepository } from "./scan.js";
import { IntelligenceClient } from "./x402.js";
import { applyAssessment, assessmentPrompt, InvalidAssessmentError, NotFoundAssessmentError } from "./assessment.js";
import { assertPublicRepository, checkedOutBranch } from "./pull-request.js";
import { checkReconciliation, reconcileAttempt, type ReconcileOutcome } from "./reconcile.js";

const INTENT_ID = "QUESTION_ANSWERING_GENERAL";

/** Execute merge accounting without wallet access, or assess eligible dependencies with durable payment evidence. */
const run = async (): Promise<void> => {
  let ledger: Awaited<ReturnType<typeof openLedger>> | undefined;
  try {
    const token = process.env.GITHUB_TOKEN ?? "";
    core.setSecret(token);
    if (!token) throw new Error("GITHUB_TOKEN is required");
    const repository = process.env.GITHUB_REPOSITORY ?? "";
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY must be owner/repo");
    const reconcileId = core.getInput("reconcile-attempt-id");
    if (reconcileId) {
      // Manual reconciliation: no wallet, no purchase; one row on the ledger.
      const txHash = core.getInput("reconcile-tx-hash");
      const amount = core.getInput("reconcile-amount-usdc");
      const reconciliation = { attemptId: reconcileId, outcome: core.getInput("reconcile-outcome") as ReconcileOutcome,
        note: core.getInput("reconcile-note"), actor: process.env.GITHUB_ACTOR ?? "",
        txHash: txHash || undefined, amountUsdc: amount ? Number(amount) : undefined };
      checkReconciliation(reconciliation);
      await assertPublicRepository(repository, token);
      ledger = await openLedger(repository, token);
      await reconcileAttempt(ledger, reconciliation);
      core.setOutput("status", "success");
      return;
    }
    const mergePrNumber = core.getInput("merge-pr-number");
    if (process.env.GITHUB_EVENT_NAME === "pull_request_target" || mergePrNumber) {
      const number = mergePrNumber ? Number(mergePrNumber)
        : JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")).pull_request.number;
      await assertPublicRepository(repository, token);
      ledger = await openLedger(repository, token);
      await recordMerge(ledger, repository, await fetchMergedPr(repository, number, token));
      core.setOutput("status", "success");
      return;
    }
    const privateKey = process.env.TELEGRAPH_EVM_PRIVATE_KEY ?? "";
    core.setSecret(privateKey);
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Invalid TELEGRAPH_EVM_PRIVATE_KEY");
    const nodeUrl = core.getInput("node-url");
    if (new URL(nodeUrl).protocol !== "https:") throw new Error("node-url must use HTTPS");
    const maxPrice = Number(core.getInput("max-price-per-call-usdc"));
    const budget = Number(core.getInput("budget-cap-usdc"));
    if (![maxPrice, budget].every((amount) => Number.isFinite(amount) && amount > 0)) {
      throw new Error("max-price-per-call-usdc and budget-cap-usdc must be positive finite numbers");
    }
    // Off unless set: a cap on all purchases in the calendar month (UTC), across runs.
    const monthlyInput = core.getInput("monthly-budget-usdc");
    const monthlyCap = monthlyInput === "" ? null : Number(monthlyInput);
    if (monthlyCap !== null && !(Number.isFinite(monthlyCap) && monthlyCap > 0)) {
      throw new Error("monthly-budget-usdc must be a positive finite number when set");
    }
    const preferredMinerId = core.getInput("preferred-miner-id") || process.env.PREFERRED_MINER_ID || null;
    if (preferredMinerId && !/^\d+$/.test(preferredMinerId)) throw new Error("preferred-miner-id must be numeric");
    const chainId = Number(core.getInput("chain-id"));
    const usdcAddress = core.getInput("usdc-address");
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[0-9a-fA-F]{40}$/.test(usdcAddress)) {
      throw new Error("Invalid chain-id or usdc-address");
    }
    const cutoff = new Date(core.getInput("model-cutoff") || process.env.MODEL_CUTOFF || "");
    if (!Number.isFinite(cutoff.getTime())) throw new Error("MODEL_CUTOFF or model-cutoff must be a valid date");
    await assertPublicRepository(repository, token);
    const scan = await scanRepository();
    const baseBranch = checkedOutBranch(scan.root);
    const baseSha = execFileSync("git", ["-C", scan.root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    for (const skipped of scan.skipped) core.warning(`${skipped.project}: ${skipped.package}: ${skipped.reason}`);
    core.setOutput("pull-requests", "[]");
    let registryFailures = 0;
    const candidates = await cutoffCandidates(scan.dependencies, cutoff, fetch, (dependency, error) => {
      registryFailures++;
      core.warning(`${dependency.package}: ${error instanceof Error ? error.message : String(error)}`);
    });
    const urls = new Set<string>();
    const failures: string[] = [];
    core.setOutput("has-findings", "false");
    core.setOutput("message", registryFailures
      ? `${registryFailures} registry lookups failed; ${candidates.length} verified candidates remain`
      : "No eligible post-cutoff upgrades; no purchase made");
    if (candidates.length) {
      core.setOutput("message", "Preparing eligible assessments");
      if (preferredMinerId === "0") {
        const message = `Skipped: preferred miner ${preferredMinerId} is a placeholder; no purchase made`;
        core.notice(message);
        core.setOutput("message", message);
        if (registryFailures) throw new Error(`Registry lookups failed for ${registryFailures} dependencies`);
        core.setOutput("status", "success");
        return;
      }
      const provenance = readModelProvenance(process.env, cutoff);
      ledger = await openLedger(repository, token);
      const client = new IntelligenceClient({ nodeUrl, evmPrivateKey: privateKey as `0x${string}`,
        chainId, usdcAddress, preferredMinerId, maxPricePerCallUsdc: maxPrice, budgetCapUsdc: budget });
      for (const dependency of candidates) {
        const purchase = await purchaseAssessment({ ledger, repository, baseSha, dependency, client, provenance,
          intent: INTENT_ID, query: assessmentPrompt([dependency]),
          monthlyBudget: monthlyCap === null ? undefined : { capUsdc: monthlyCap, worstCaseUsdc: maxPrice },
          onPurchase: (paid) => {
            core.setOutput("message", JSON.stringify(paid));
            if (!paid.receiptHash || !paid.signalHash || !paid.txHash) {
              core.warning(`${dependency.package}: paid evidence is incomplete; reconcile missing hashes from the node or wallet`);
            }
          } });
        try {
          await applyAssessment({ root: scan.root, repository, baseBranch, baseSha, token,
            dependencies: [dependency], purchase, onPublished: (published) => {
              for (const url of published) urls.add(url);
              core.setOutput("has-findings", String(urls.size > 0));
              core.setOutput("pull-requests", JSON.stringify([...urls]));
            }, onProposal: async (url, finding) => {
              const prNumber = Number(/\/pull\/(\d+)$/.exec(url)?.[1]);
              if (!Number.isSafeInteger(prNumber) || prNumber <= 0) throw new Error(`Cannot read the PR number from ${url}`);
              await recordProposal(ledger!, { repo: repository, prNumber, prUrl: url,
                assessmentId: purchase.assessmentId, attemptId: purchase.attemptId, receiptHash: purchase.receiptHash,
                ecosystem: finding.ecosystem, package: finding.package, source: finding.source,
                currentVersion: finding.currentVersion, targetVersion: finding.targetVersion });
            } });
        } catch (error) {
          if (error instanceof InvalidAssessmentError || error instanceof NotFoundAssessmentError) {
            await markAssessmentResult(ledger, purchase.attemptId,
              error instanceof NotFoundAssessmentError ? "not_found" : "unusable", error.message);
            if (error instanceof NotFoundAssessmentError) { core.notice(`${dependency.package}: ${error.message}`); continue; }
          }
          failures.push(`${dependency.package}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      core.setOutput("has-findings", String(urls.size > 0));
      core.setOutput("pull-requests", JSON.stringify([...urls]));
      for (const url of urls) core.info(`Dependency pull request: ${url}`);
    }
    if (registryFailures) failures.push(`Registry lookups failed for ${registryFailures} dependencies`);
    if (failures.length) throw new Error(`Assessment run failed: ${failures.join("; ")}`);
    core.setOutput("status", "success");
  } catch (error: unknown) {
    core.setOutput("status", "failed");
    core.setFailed(error instanceof Error ? error.message : String(error));
  } finally {
    if (ledger) rmSync(ledger.directory, { recursive: true, force: true });
  }
};

void run();
