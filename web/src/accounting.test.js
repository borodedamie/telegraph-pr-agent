import { test } from "node:test";
import assert from "node:assert/strict";
import { mergedCosts, purchaseRows } from "./accounting.js";

test("allocates settled receipt costs once and excludes unmatched, failed and cross-repo records", () => {
  const purchase = { repo: "team/repo", status: "settled", receiptHash: "one", amountUsdc: 0.02 };
  const merge = { kind: "merge", repo: "team/repo", prNumber: 1, receiptHash: "one" };
  const rows = [purchase, merge, merge,
    { ...purchase, receiptHash: "two", amountUsdc: 0.04 },
    { ...merge, prNumber: 2, receiptHash: "two" },
    { ...purchase, receiptHash: "failed", status: "failed" },
    { ...merge, prNumber: 3, receiptHash: "failed" },
    { ...merge, prNumber: 4, receiptHash: "missing" },
    { ...purchase, receiptHash: "", amountUsdc: 99 },
    { ...merge, prNumber: 6, receiptHash: "" },
    { ...merge, repo: "other/repo", prNumber: 5 }];
  assert.deepEqual(mergedCosts(rows), { total: 0.06, count: 2, average: 0.03, netSpend: 99.06, unmergedSpend: 99, costPerMergedPr: 49.53 });
  assert.deepEqual(mergedCosts([purchase]), { total: 0, count: 0, average: null, netSpend: 0.02, unmergedSpend: 0.02, costPerMergedPr: null });
});

test("projects the latest assessment quality without altering purchase evidence", () => {
  const purchase = { assessmentId: "one", attemptId: "one:1", receiptHash: "receipt", resultStatus: "unchecked" };
  const second = { ...purchase, attemptId: "one:2", receiptHash: "second" };
  assert.deepEqual(purchaseRows([purchase, second,
    { kind: "attempt", assessmentId: "one", attemptId: "one:1", resultStatus: "useful" },
    { kind: "attempt", assessmentId: "one", attemptId: "one:1", resultStatus: "unusable" },
    { kind: "attempt", resultStatus: "unusable" }, { receiptHash: "legacy", resultStatus: "unchecked" }]),
  [{ ...purchase, resultStatus: "unusable" }, second, { receiptHash: "legacy", resultStatus: "unchecked" }]);
  assert.equal(purchase.resultStatus, "unchecked");
});

test("includes unmerged and not-found spending while keeping merge allocation separate", () => {
  const merged = { repo: "team/repo", status: "settled", receiptHash: "merged", amountUsdc: 0.02 };
  const unmerged = { ...merged, receiptHash: "unmerged", amountUsdc: 0.04, resultStatus: "not_found" };
  const costs = mergedCosts([merged, merged, unmerged, { kind: "merge", repo: "team/repo", prNumber: 1, receiptHash: "merged" },
    { kind: "attempt", state: "failed_and_credited", quotedAmountUsdc: 1 }]);
  assert.deepEqual(costs, { total: 0.02, count: 1, average: 0.02, netSpend: 0.06, unmergedSpend: 0.06 - 0.02, costPerMergedPr: 0.06 });
});
