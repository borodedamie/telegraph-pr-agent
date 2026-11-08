import { test } from "node:test";
import assert from "node:assert/strict";
import { mergedCosts } from "./accounting.js";

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
  assert.deepEqual(mergedCosts(rows), { total: 0.06, count: 2, average: 0.03 });
  assert.deepEqual(mergedCosts([purchase]), { total: 0, count: 0, average: null });
});
