import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  info: vi.fn(), NotFoundAssessmentError: class extends Error {}, fetchPr: vi.fn(), InvalidAssessmentError: class extends Error {}, unusable: vi.fn(), notice: vi.fn(), merge: vi.fn(), read: vi.fn(), visibility: vi.fn(), candidates: vi.fn(), open: vi.fn(), purchase: vi.fn(),
  buy: vi.fn(), client: vi.fn(), apply: vi.fn(), failed: vi.fn(), output: vi.fn(),
  inputs: {} as Record<string, string>, proposal: vi.fn(), reconcile: vi.fn(), checkReconciliation: vi.fn(),
}));
vi.mock("@actions/core", () => ({
  setSecret: vi.fn(), setFailed: mocks.failed, setOutput: mocks.output,
  notice: mocks.notice, warning: vi.fn(), info: mocks.info, getInput: (name: string) => mocks.inputs[name] ?? "",
}));
vi.mock("node:child_process", () => ({ execFileSync: () => "a".repeat(40) }));
vi.mock("node:fs", () => ({ rmSync: vi.fn(), readFileSync: mocks.read }));
vi.mock("../src/accounting.js", () => ({ recordMerge: mocks.merge, fetchMergedPr: mocks.fetchPr }));
vi.mock("../src/scan.js", () => ({ scanRepository: async () => ({
  root: "/repo", skipped: [], dependencies: [{ package: "zod" }],
}) }));
vi.mock("../src/cutoff.js", () => ({ cutoffCandidates: mocks.candidates }));
vi.mock("../src/purchase.js", () => ({ openLedger: mocks.open, purchaseAssessment: mocks.purchase, markAssessmentResult: mocks.unusable, recordProposal: mocks.proposal }));
vi.mock("../src/pull-request.js", () => ({ checkedOutBranch: () => "feature", assertPublicRepository: mocks.visibility }));
vi.mock("../src/assessment.js", () => ({ NotFoundAssessmentError: mocks.NotFoundAssessmentError, InvalidAssessmentError: mocks.InvalidAssessmentError, assessmentPrompt: () => "assess dependencies", applyAssessment: mocks.apply }));
vi.mock("../src/reconcile.js", () => ({ checkReconciliation: mocks.checkReconciliation, reconcileAttempt: mocks.reconcile }));
vi.mock("../src/x402.js", () => ({ IntelligenceClient: function (options: unknown) {
  mocks.client(options);
  return { buy: mocks.buy };
} }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.inputs = { "node-url": "https://devnode.test", "max-price-per-call-usdc": "1",
    "budget-cap-usdc": "1", "chain-id": "11155111", "usdc-address": "0xcc194e1a843B658526D0D5C431f670028582Ae17" };
  vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", `0x${"a".repeat(64)}`);
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  vi.stubEnv("GITHUB_REPOSITORY", "team/repo");
  vi.stubEnv("MODEL_CUTOFF", "2025-01-01");
  vi.stubEnv("MODEL_PROVIDER", "test-provider");
  vi.stubEnv("MODEL_ID", "test-model");
  vi.stubEnv("MODEL_CUTOFF_SOURCE_URL", "https://example.org/model-assumption");
  vi.stubEnv("MODEL_CUTOFF_STATUS", "team-assumed");
  vi.stubEnv("PREFERRED_MINER_ID", "");
  vi.stubEnv("GITHUB_EVENT_NAME", "");
  mocks.candidates.mockResolvedValue([{ package: "zod", targetVersion: "4.0.0" }]);
  mocks.open.mockResolvedValue({ directory: "/mock-ledger" });
  mocks.buy.mockResolvedValue({ answer: '{"findings":[]}' });
  mocks.purchase.mockImplementation(async ({ client, intent, query, onPurchase }) => {
    const purchase = await client.buy(intent, query);
    onPurchase(purchase);
    return purchase;
  });
  mocks.apply.mockResolvedValue([]);
  mocks.fetchPr.mockResolvedValue({ number: 42 });
  mocks.read.mockReturnValue(JSON.stringify({ pull_request: { number: 42 } }));
});
afterEach(() => vi.unstubAllEnvs());
const run = async (status = "success") => {
  await import("../src/action.js");
  await vi.waitFor(() => expect(mocks.output).toHaveBeenCalledWith("status", status));
};

it("uses the configured payment network and gated assessment", async () => {
  await run();
  expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({
    chainId: 11155111, usdcAddress: mocks.inputs["usdc-address"],
  }));
  expect(mocks.buy).toHaveBeenCalledWith("QUESTION_ANSWERING_GENERAL", "assess dependencies");
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ purchase: { answer: '{"findings":[]}' } }));
});

it.each(["wallet", "cutoff", "miner", "network"])("rejects invalid %s configuration before purchase", async (field) => {
  if (field === "wallet") vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", "");
  if (field === "cutoff") vi.stubEnv("MODEL_CUTOFF", "");
  if (field === "miner") mocks.inputs["preferred-miner-id"] = "not-an-id";
  if (field === "network") mocks.inputs["chain-id"] = "invalid";
  await run("failed");
  expect(mocks.buy).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it.each([false, true])("forwards the preferred miner from input or env (input: %s)", async (input) => {
  vi.stubEnv("PREFERRED_MINER_ID", "302");
  if (input) mocks.inputs["preferred-miner-id"] = "303";
  await run();
  expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ preferredMinerId: input ? "303" : "302" }));
});

it("does not purchase when repository visibility cannot be confirmed", async () => {
  mocks.visibility.mockRejectedValueOnce(new Error("Repository visibility unknown"));
  await run("failed");
  expect(mocks.failed).toHaveBeenCalledWith("Repository visibility unknown");
  expect(mocks.buy).not.toHaveBeenCalled();
});

it("makes no purchase or PR when there is no post-cutoff candidate", async () => {
  mocks.candidates.mockResolvedValue([]);
  await run();
  expect(mocks.buy).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});

it("reuses a delivered assessment to finish publication without paying again", async () => {
  mocks.purchase.mockResolvedValue({ answer: '{"findings":[]}' });
  await run();
  expect(mocks.buy).not.toHaveBeenCalled();
  expect(mocks.apply).toHaveBeenCalledOnce();
});

it("retains incremental PR output and paid evidence when publication fails", async () => {
  mocks.apply.mockImplementationOnce(async ({ onPublished }) => {
    onPublished(["https://github.com/team/repo/pull/1"]);
    throw new Error("Later publication failed");
  });
  await run("failed");
  expect(mocks.failed).toHaveBeenCalledWith(expect.stringContaining("Later publication failed"));
  expect(mocks.unusable).not.toHaveBeenCalled();
  expect(mocks.output).toHaveBeenCalledWith("pull-requests", '["https://github.com/team/repo/pull/1"]');
  expect(mocks.output).toHaveBeenCalledWith("message", '{"answer":"{\\"findings\\":[]}"}');
});

it("passes the monthly budget only when monthly-budget-usdc is set", async () => {
  await run();
  expect(mocks.purchase.mock.calls[0][0].monthlyBudget).toBeUndefined();

  vi.resetModules();
  mocks.purchase.mockClear();
  mocks.output.mockClear();
  mocks.inputs["monthly-budget-usdc"] = "5";
  await run();
  expect(mocks.purchase.mock.calls[0][0].monthlyBudget).toEqual({ capUsdc: 5, worstCaseUsdc: 1 });
});

it("rejects an invalid monthly budget before opening the ledger", async () => {
  mocks.inputs["monthly-budget-usdc"] = "-1";
  await run("failed");
  expect(mocks.failed).toHaveBeenCalledWith(expect.stringContaining("monthly-budget-usdc"));
  expect(mocks.open).not.toHaveBeenCalled();
});

it("logs each upgrade skipped as not after the cutoff and sums them up once, without buying", async () => {
  mocks.candidates.mockImplementationOnce(async (_deps, _cutoff, _fetch, _report, onSkip) => {
    onSkip({ package: "lodash", currentVersion: "4.17.21" }, "4.18.1", "2026-04-01T00:00:00Z");
    onSkip({ package: "left-pad", currentVersion: "1.0.0" }, "1.3.0", null);
    return [];
  });
  await run();
  expect(mocks.info).toHaveBeenCalledWith(expect.stringMatching(/^lodash 4\.17\.21 → 4\.18\.1: released 2026-04-01, not after the model cutoff \d{4}-\d{2}-\d{2}; skipped, no purchase$/));
  expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("left-pad 1.0.0 → 1.3.0: released on an unknown date"));
  expect(mocks.notice).toHaveBeenCalledWith(expect.stringMatching(/^2 newer releases not after the model cutoff .*skipped without purchase/));
  expect(mocks.open).not.toHaveBeenCalled();
});

it("rejects an invalid draft-prs value before opening the ledger", async () => {
  mocks.inputs["draft-prs"] = "yes";
  await run("failed");
  expect(mocks.failed).toHaveBeenCalledWith(expect.stringContaining("draft-prs"));
  expect(mocks.open).not.toHaveBeenCalled();
});

it.each([["", false], ["false", false], ["true", true]])("passes draft-prs=%j to publication as draft %s", async (value, draft) => {
  mocks.inputs["draft-prs"] = value;
  mocks.buy.mockResolvedValue({ answer: "{}", assessmentId: "assess-1", attemptId: "assess-1:1", receiptHash: "0xreceipt" });
  mocks.apply.mockResolvedValueOnce([]);
  await run();
  expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ draft }));
});

it("records each published PR on the ledger with its number, purchase and finding", async () => {
  mocks.buy.mockResolvedValue({ answer: "{}", assessmentId: "assess-1", attemptId: "assess-1:1", receiptHash: "0xreceipt" });
  const finding = { ecosystem: "npm", package: "zod", source: "package.json", currentVersion: "3.25.0", targetVersion: "4.6.7" };
  mocks.apply.mockImplementationOnce(async ({ onProposal }) => {
    await onProposal("https://github.com/team/repo/pull/51", finding);
    return ["https://github.com/team/repo/pull/51"];
  });
  await run();
  expect(mocks.proposal).toHaveBeenCalledWith({ directory: "/mock-ledger" }, {
    repo: "team/repo", prNumber: 51, prUrl: "https://github.com/team/repo/pull/51",
    assessmentId: "assess-1", attemptId: "assess-1:1", receiptHash: "0xreceipt", ...finding,
  });
  expect(mocks.notice).toHaveBeenCalledWith("Spend dashboard: https://telegraph-pr-agent.vercel.app/?repo=team/repo");
});

it("fails the run when a published PR cannot be recorded", async () => {
  mocks.proposal.mockRejectedValueOnce(new Error("ledger push failed"));
  mocks.apply.mockImplementationOnce(async ({ onProposal }) => {
    await onProposal("https://github.com/team/repo/pull/51", { ecosystem: "npm", package: "zod" });
    return [];
  });
  await run("failed");
  expect(mocks.failed).toHaveBeenCalledWith(expect.stringContaining("ledger push failed"));
});

it("reconciles an attempt without a wallet, scan or payment", async () => {
  vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", "");
  vi.stubEnv("MODEL_CUTOFF", "");
  vi.stubEnv("GITHUB_ACTOR", "borodedamie");
  Object.assign(mocks.inputs, { "reconcile-attempt-id": "assess:1", "reconcile-outcome": "failed_and_charged",
    "reconcile-note": "found the transfer", "reconcile-tx-hash": `0x${"a".repeat(64)}`, "reconcile-amount-usdc": "0.02" });
  await run();
  expect(mocks.reconcile).toHaveBeenCalledWith({ directory: "/mock-ledger" }, { attemptId: "assess:1",
    outcome: "failed_and_charged", note: "found the transfer", actor: "borodedamie",
    txHash: `0x${"a".repeat(64)}`, amountUsdc: 0.02 });
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.candidates).not.toHaveBeenCalled();
});

it("validates reconciliation inputs before opening the ledger", async () => {
  vi.stubEnv("GITHUB_ACTOR", "borodedamie");
  mocks.checkReconciliation.mockImplementation(() => { throw new Error("failed_and_charged needs reconcile-tx-hash"); });
  Object.assign(mocks.inputs, { "reconcile-attempt-id": "assess:1", "reconcile-outcome": "failed_and_charged",
    "reconcile-note": "found the transfer" });
  await run("failed");
  expect(mocks.failed).toHaveBeenCalledWith(expect.stringContaining("reconcile-tx-hash"));
  expect(mocks.open).not.toHaveBeenCalled();
});

it("records merge events without a wallet, miner selection or payment", async () => {
  vi.stubEnv("GITHUB_EVENT_NAME", "pull_request_target");
  vi.stubEnv("GITHUB_EVENT_PATH", "/event.json");
  vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", "");
  vi.stubEnv("MODEL_CUTOFF", "");
  await run();
  expect(mocks.merge).toHaveBeenCalledWith({ directory: "/mock-ledger" }, "team/repo", { number: 42 });
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.buy).not.toHaveBeenCalled();
});

it("continues past a bad saved answer and keeps earlier partial PR outputs", async () => {
  mocks.candidates.mockResolvedValue([{ package: "bad" }, { package: "good" }]);
  mocks.apply.mockImplementationOnce(async ({ onPublished }) => {
    onPublished(["https://github.com/team/repo/pull/1"]);
    throw new Error("Invalid answer");
  }).mockImplementationOnce(async ({ onPublished }) => {
    onPublished(["https://github.com/team/repo/pull/2"]);
    return ["https://github.com/team/repo/pull/2"];
  });
  await run("failed");
  expect(mocks.apply).toHaveBeenCalledTimes(2);
  expect(mocks.output).toHaveBeenLastCalledWith("status", "failed");
  expect(mocks.output).toHaveBeenCalledWith("pull-requests",
    '["https://github.com/team/repo/pull/1","https://github.com/team/repo/pull/2"]');
  expect(mocks.failed).toHaveBeenCalledWith(expect.stringContaining("bad: Invalid answer"));
});

it("stops before later candidates when payment or ledger handling fails", async () => {
  mocks.candidates.mockResolvedValue([{ package: "first" }, { package: "second" }]);
  mocks.purchase.mockRejectedValueOnce(new Error("Payment outcome unknown"));
  await run("failed");
  expect(mocks.purchase).toHaveBeenCalledOnce();
  expect(mocks.apply).not.toHaveBeenCalled();
});

it.each(["0"])("skips unavailable preferred miner %s before any ledger or paid request", async (miner) => {
  vi.stubEnv("PREFERRED_MINER_ID", miner);
  await run();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.buy).not.toHaveBeenCalled();
  expect(mocks.failed).not.toHaveBeenCalled();
  expect(mocks.notice).toHaveBeenCalledWith(expect.stringContaining("no purchase made"));
});

it.each([true, false])("reports registry failures after processing verified candidates (candidate: %s)", async (candidate) => {
  mocks.candidates.mockImplementationOnce(async (_dependencies, _cutoff, _fetch, report) => {
    report({ package: "unavailable" }, new Error("HTTP 503"));
    return candidate ? [{ package: "zod", targetVersion: "4.0.0" }] : [];
  });
  await run("failed");
  expect(mocks.failed).toHaveBeenCalledWith(expect.stringContaining("Registry lookups failed for 1 dependencies"));
  expect(mocks.output).toHaveBeenCalledWith("message", expect.stringContaining("1 registry lookups failed"));
  expect(mocks.buy).toHaveBeenCalledTimes(candidate ? 1 : 0);
});

it.each([false, true])("marks invalid answers unusable and stops if recording fails (%s)", async (writeFails) => {
  mocks.candidates.mockResolvedValue([{ package: "bad" }, { package: "good" }]);
  mocks.purchase.mockResolvedValue({ answer: "not JSON", assessmentId: "assessment", attemptId: "assessment:1" });
  mocks.apply.mockRejectedValueOnce(new mocks.InvalidAssessmentError("Invalid JSON"));
  if (writeFails) mocks.unusable.mockRejectedValueOnce(new Error("Ledger unavailable"));
  await run("failed");
  expect(mocks.unusable).toHaveBeenCalledExactlyOnceWith({ directory: "/mock-ledger" }, "assessment:1", "unusable", "Invalid JSON");
  expect(mocks.purchase).toHaveBeenCalledTimes(writeFails ? 1 : 2);
});

it("passes the required miner 7314 through to payment and assessment", async () => {
  vi.stubEnv("PREFERRED_MINER_ID", "7314");
  await run();
  expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ preferredMinerId: "7314" }));
  expect(mocks.purchase).toHaveBeenCalledOnce();
  expect(mocks.apply).toHaveBeenCalledOnce();
});

it("records not_found as a successful report-only outcome", async () => {
  mocks.purchase.mockResolvedValue({ attemptId: "one:1", answer: "not found" });
  mocks.apply.mockRejectedValueOnce(new mocks.NotFoundAssessmentError("Suitable release information was not found"));
  await run();
  expect(mocks.unusable).toHaveBeenCalledWith({ directory: "/mock-ledger" }, "one:1", "not_found", expect.any(String));
  expect(mocks.failed).not.toHaveBeenCalled();
});

it("recovers merge accounting from a current PR lookup without payment configuration", async () => {
  mocks.inputs["merge-pr-number"] = "42";
  vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", "");
  await run();
  expect(mocks.fetchPr).toHaveBeenCalledWith("team/repo", 42, "test-token");
  expect(mocks.merge).toHaveBeenCalledWith({ directory: "/mock-ledger" }, "team/repo", { number: 42 });
  expect(mocks.buy).not.toHaveBeenCalled();
});

it.each(["MODEL_PROVIDER", "MODEL_ID"])("blocks placeholder %s before opening the ledger or paying", async (field) => {
  vi.stubEnv(field, field === "MODEL_PROVIDER" ? "assumed-provider" : "assumed-model");
  await run("failed");
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.buy).not.toHaveBeenCalled();
});
