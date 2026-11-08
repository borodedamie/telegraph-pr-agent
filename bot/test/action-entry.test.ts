import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  merge: vi.fn(), read: vi.fn(), visibility: vi.fn(), candidates: vi.fn(), open: vi.fn(), purchase: vi.fn(),
  buy: vi.fn(), client: vi.fn(), apply: vi.fn(), failed: vi.fn(), output: vi.fn(),
  inputs: {} as Record<string, string>,
}));
vi.mock("../actions/node_modules/@actions/core/lib/core.js", () => ({
  setSecret: vi.fn(), setFailed: mocks.failed, setOutput: mocks.output,
  warning: vi.fn(), info: vi.fn(), getInput: (name: string) => mocks.inputs[name] ?? "",
}));
vi.mock("node:child_process", () => ({ execFileSync: () => "a".repeat(40) }));
vi.mock("node:fs", () => ({ rmSync: vi.fn(), readFileSync: mocks.read }));
vi.mock("../actions/src/accounting", () => ({ recordMerge: mocks.merge }));
vi.mock("../actions/src/scan", () => ({ scanRepository: async () => ({
  root: "/repo", skipped: [], dependencies: [{ package: "zod" }],
}) }));
vi.mock("../actions/src/cutoff", () => ({ cutoffCandidates: mocks.candidates }));
vi.mock("../actions/src/purchase", () => ({ openLedger: mocks.open, purchaseAssessment: mocks.purchase }));
vi.mock("../actions/src/pull-request", () => ({ checkedOutBranch: () => "feature", assertPublicRepository: mocks.visibility }));
vi.mock("../actions/src/assessment", () => ({ assessmentPrompt: () => "assess dependencies", applyAssessment: mocks.apply }));
vi.mock("../src/x402", () => ({ IntelligenceClient: function (options: unknown) {
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
  vi.stubEnv("MODEL_PROVIDER", "assumed-provider");
  vi.stubEnv("MODEL_ID", "assumed-model");
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
  mocks.read.mockReturnValue(JSON.stringify({ pull_request: { number: 42 } }));
});
afterEach(() => vi.unstubAllEnvs());
const run = async (status = "success") => {
  await import("../actions/src/index.js");
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
  expect(mocks.output).toHaveBeenCalledWith("pull-requests", '["https://github.com/team/repo/pull/1"]');
  expect(mocks.output).toHaveBeenCalledWith("message", '{"answer":"{\\"findings\\":[]}"}');
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

it("blocks the assumed miner placeholder before any ledger or paid request", async () => {
  vi.stubEnv("PREFERRED_MINER_ID", "0");
  await run("failed");
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.buy).not.toHaveBeenCalled();
  expect(mocks.failed).toHaveBeenCalledWith(expect.stringContaining("assumed placeholder"));
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
