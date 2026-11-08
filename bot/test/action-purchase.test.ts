import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { purchaseAssessment } from "../actions/src/purchase.js";
import { LEDGER_FILE, type AttemptRow } from "../src/ledger.js";
import type { OnAttempt, Purchase } from "../src/x402.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "assessment-test-"));
  directories.push(directory);
  const path = join(directory, LEDGER_FILE);
  writeFileSync(path, "");
  let remote = "";
  const runGit = vi.fn(async (args: string[]) => {
    if (args[0] === "checkout") writeFileSync(path, remote);
    if (args[0] === "push") remote = readFileSync(path, "utf8");
  });
  let payments = 0;
  const purchase: Purchase = { intent: "qa", minerId: "302", minerName: "Preferred", minerRank: null,
    minerScore: null, selectedBy: "our_choice", amountUsdc: 0.01, answer: '{"findings":[]}',
    status: "settled", txHash: "tx", receiptHash: "receipt", signalHash: "signal", network: "eip155:11155111",
    chainId: 11155111, usdcContract: `0x${"b".repeat(40)}`, explorerBaseUrl: "https://sepolia.etherscan.io" };
  const buy = vi.fn(async (_intent: string, _query: string, onAttempt?: OnAttempt) => {
    await onAttempt!({ state: "reserved", minerId: "302" });
    await onAttempt!({ state: "request_sent", minerId: "302", quotedAmountUsdc: 0.01 });
    payments++;
    return { ...purchase, receiptHash: `receipt-${payments}` };
  });
  const options = { provenance: { provider: "assumed-provider", model: "assumed-model", cutoff: "2025-01-01T00:00:00.000Z",
    sourceUrl: "https://example.org/model-assumption", status: "team-assumed" as const, configuredAt: "2026-11-08T00:00:00.000Z" }, ledger: { directory, runGit }, client: { buy }, repository: "team/repo", baseSha: "sha1",
    dependency: { ecosystem: "npm" as const, package: "foo", source: "package.json", declared: "^1.0.0",
      currentVersion: "1.0.0", targetVersion: "2.0.0" }, intent: "qa", query: "assess foo 1 to 2", onPurchase: vi.fn() };
  return { options, buy, runGit, path, purchase, rows: () => remote.trim().split("\n").map((line) => JSON.parse(line)),
    setRemote: (contents: string) => { remote = contents; }, payments: () => payments };
};

it("persists payment stages and one dashboard-compatible purchase before returning", async () => {
  const f = fixture();
  const purchase = await purchaseAssessment(f.options);
  expect(f.rows().map((r) => r.state ?? "purchase")).toEqual(["reserved", "request_sent", "purchase", "delivered"]);
  expect(f.rows()[2]).toMatchObject({ repo: "team/repo", package: "foo", currentVersion: "1.0.0", targetVersion: "2.0.0",
    amountUsdc: 0.01, selectedBy: "our_choice", resultStatus: "unchecked", receiptHash: purchase!.receiptHash });
  expect(f.rows()[2].prNumber).toBeUndefined();
  expect(f.rows()[0].model).toEqual(f.options.provenance);
  expect(f.rows()[2].model).toEqual(f.options.provenance);
  expect(f.options.onPurchase).toHaveBeenCalledWith(purchase);
});

it("skips the same assessment across reruns and different base SHAs, allowing a new version", async () => {
  const f = fixture();
  await purchaseAssessment(f.options);
  expect(await purchaseAssessment({ ...f.options, baseSha: "sha2" })).toMatchObject({
    answer: '{"findings":[]}', receiptHash: "receipt-1",
  });
  expect(f.buy).toHaveBeenCalledTimes(1);
  await purchaseAssessment({ ...f.options, dependency: { ...f.options.dependency, targetVersion: "3.0.0" }, query: "assess foo 1 to 3" });
  expect(f.payments()).toBe(2);
});

it("blocks another purchase when the prior paid request has an uncertain outcome", async () => {
  const f = fixture();
  f.buy.mockImplementationOnce(async (_intent, _query, onAttempt) => {
    await onAttempt!({ state: "reserved", minerId: "302" });
    await onAttempt!({ state: "request_sent", minerId: "302" });
    await onAttempt!({ state: "unknown_needs_reconciliation", minerId: "302" });
    throw new Error("Uncertain payment");
  });
  await expect(purchaseAssessment(f.options)).rejects.toThrow("Uncertain payment");
  await expect(purchaseAssessment(f.options)).rejects.toThrow(/outcome unknown/);
  expect(f.buy).toHaveBeenCalledTimes(1);
});

it("rechecks the fresh ledger on a push conflict before allowing payment", async () => {
  const f = fixture();
  const original = f.runGit.getMockImplementation()!;
  let pushes = 0;
  f.runGit.mockImplementation(async (args) => {
    if (args[0] === "push" && ++pushes === 2) {
      const reserved: AttemptRow = f.rows()[0];
      f.setRemote(`${JSON.stringify(reserved)}\n${JSON.stringify({ ...reserved, attemptId: "competitor", attempt: 2, state: "request_sent" })}\n`);
      throw new Error("non-fast-forward");
    }
    await original(args);
  });
  await expect(purchaseAssessment(f.options)).rejects.toThrow(/another run is paying/);
  expect(f.payments()).toBe(0);
});

it("preserves paid output and blocks retries after recording the purchase fails", async () => {
  const f = fixture();
  const original = f.runGit.getMockImplementation()!;
  let pushes = 0;
  f.runGit.mockImplementation(async (args) => {
    if (args[0] === "push" && ++pushes >= 3) throw new Error("push unavailable");
    await original(args);
  });
  await expect(purchaseAssessment(f.options)).rejects.toThrow(/ledger push failed/);
  expect(f.options.onPurchase).toHaveBeenCalledOnce();
  expect(f.payments()).toBe(1);
  f.runGit.mockImplementation(original);
  await expect(purchaseAssessment(f.options)).rejects.toThrow(/outcome unknown/);
  expect(f.payments()).toBe(1);
});

it("fails closed on malformed ledger contents", async () => {
  const f = fixture();
  f.setRemote("not-json\n");
  await expect(purchaseAssessment(f.options)).rejects.toThrow();
  expect(f.buy).not.toHaveBeenCalled();
});

it("makes no paid request if reserving the attempt cannot be persisted", async () => {
  const f = fixture();
  const original = f.runGit.getMockImplementation()!;
  f.runGit.mockImplementation(async (args) => {
    if (args[0] === "push") throw new Error("write permission denied");
    await original(args);
  });
  await expect(purchaseAssessment(f.options)).rejects.toThrow(/ledger push failed/);
  expect(f.payments()).toBe(0);
  expect(f.options.onPurchase).not.toHaveBeenCalled();
});

it("reuses paid answers with missing evidence without paying twice", async () => {
  const f = fixture();
  const original = f.buy.getMockImplementation()!;
  f.buy.mockImplementation(async (intent, query, onAttempt) => ({
    ...await original(intent, query, onAttempt), receiptHash: "", signalHash: "", txHash: "",
  }));
  await purchaseAssessment(f.options);
  expect(await purchaseAssessment(f.options)).toMatchObject({ answer: '{"findings":[]}', receiptHash: "", signalHash: "", txHash: "" });
  expect(f.rows().find((row) => !row.kind).evidenceIncomplete).toBe(true);
  expect(f.payments()).toBe(1);
});
