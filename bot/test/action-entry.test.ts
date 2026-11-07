import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  visibility: vi.fn(), buy: vi.fn(), client: vi.fn(), apply: vi.fn(), failed: vi.fn(), output: vi.fn(),
}));
vi.mock("../actions/node_modules/@actions/core/lib/core.js", () => ({
  setSecret: vi.fn(), setFailed: mocks.failed, setOutput: mocks.output,
  warning: vi.fn(), info: vi.fn(),
  getInput: (name: string) => name === "node-url" ? "https://devnode.test" : "1",
}));
vi.mock("node:child_process", () => ({ execFileSync: () => "a".repeat(40) }));
vi.mock("../actions/src/scan", () => ({ scanRepository: async () => ({
  root: "/repo", skipped: [], dependencies: [{ package: "zod" }],
}) }));
vi.mock("../actions/src/pull-request", () => ({ checkedOutBranch: () => "feature", assertPublicRepository: mocks.visibility }));
vi.mock("../actions/src/assessment", () => ({ assessmentPrompt: () => "assess dependencies", applyAssessment: mocks.apply }));
vi.mock("../src/x402", () => ({ IntelligenceClient: function (options: unknown) {
  mocks.client(options);
  return { buy: mocks.buy };
} }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each([true, false])("uses fixed payment defaults and validates the wallet key (valid: %s)", async (valid) => {
  vi.resetModules();
  vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", valid ? `0x${"a".repeat(64)}` : "");
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  vi.stubEnv("GITHUB_REPOSITORY", "team/repo");
  vi.stubEnv("CHAIN_ID", "");
  vi.stubEnv("USDC_ADDRESS", "");
  const purchase = { answer: '{"findings":[]}' };
  mocks.buy.mockResolvedValue(purchase);
  mocks.apply.mockResolvedValue([]);
  await import("../actions/src/index.js");
  if (valid) {
    await vi.waitFor(() => expect(mocks.output).toHaveBeenCalledWith("status", "success"));
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({
      chainId: 11155111, usdcAddress: "0xcc194e1a843B658526D0D5C431f670028582Ae17",
    }));
    expect(mocks.buy).toHaveBeenCalledWith("QUESTION_ANSWERING_GENERAL", "assess dependencies");
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ purchase }));
    expect(mocks.failed).not.toHaveBeenCalled();
  } else {
    expect(mocks.failed).toHaveBeenCalledWith("Invalid TELEGRAPH_EVM_PRIVATE_KEY");
    expect(mocks.buy).not.toHaveBeenCalled();
  }
});

it("does not purchase when repository visibility cannot be confirmed", async () => {
  vi.resetModules();
  vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", `0x${"a".repeat(64)}`);
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  vi.stubEnv("GITHUB_REPOSITORY", "team/repo");
  mocks.visibility.mockRejectedValueOnce(new Error("Repository visibility unknown"));
  await import("../actions/src/index.js");
  await vi.waitFor(() => expect(mocks.failed).toHaveBeenCalledWith("Repository visibility unknown"));
  expect(mocks.buy).not.toHaveBeenCalled();
});

it("retains incremental PR output when publication fails", async () => {
  vi.resetModules();
  vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", `0x${"a".repeat(64)}`);
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  vi.stubEnv("GITHUB_REPOSITORY", "team/repo");
  mocks.apply.mockImplementationOnce(async ({ onPublished }) => {
    onPublished(["https://github.com/team/repo/pull/1"]);
    throw new Error("Later publication failed");
  });
  await import("../actions/src/index.js");
  await vi.waitFor(() => expect(mocks.failed).toHaveBeenCalledWith("Later publication failed"));
  expect(mocks.output).toHaveBeenCalledWith("pull-requests", '["https://github.com/team/repo/pull/1"]');
  expect(mocks.output).toHaveBeenCalledWith("status", "failed");
});
