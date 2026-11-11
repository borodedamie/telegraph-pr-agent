import { test } from "node:test";
import assert from "node:assert/strict";
import { chargedWithoutAnswer, EVENT_WINDOW, evidenceCsv, inWindow, mergedCosts, outcomeSummary, purchaseRows } from "./accounting.js";

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

test("counts proposed, merged, closed and open PRs, and the merge rate", () => {
  const paid = (receiptHash, amountUsdc, attemptId) => ({ repo: "r", status: "settled", receiptHash, amountUsdc, attemptId });
  const rows = [
    paid("a", 0.25, "a:1"), paid("b", 0.5, "b:1"), paid("c", 0.125, "c:1"), paid("d", 1, "d:1"),
    { kind: "proposal", repo: "r", prNumber: 1, receiptHash: "a" },
    { kind: "proposal", repo: "r", prNumber: 2, receiptHash: "b" },
    { kind: "proposal", repo: "r", prNumber: 3, receiptHash: "c" },
    { kind: "merge", repo: "r", prNumber: 1, receiptHash: "a" },
    { kind: "closed", repo: "r", prNumber: 2, receiptHash: "b" },
    // closed, then reopened and merged: counts as merged only
    { kind: "closed", repo: "r", prNumber: 4, receiptHash: "d" },
    { kind: "merge", repo: "r", prNumber: 4, receiptHash: "d" },
  ];
  const summary = outcomeSummary(rows);
  assert.deepEqual({ ...summary, escrowCredits: undefined, refusedQuotes: undefined, chargedWithoutAnswer: undefined }, {
    proposed: 4, merged: 2, closed: 1, open: 1, mergeRate: 0.5, closedSpend: 0.5,
    useful: 0, costPerUsefulAnswer: null, escrowCredits: undefined, refusedQuotes: undefined, chargedWithoutAnswer: undefined,
  });
  assert.equal(outcomeSummary([]).mergeRate, null);
});

test("counts a merge from before proposal rows existed as a proposed PR", () => {
  const summary = outcomeSummary([{ kind: "merge", repo: "r", prNumber: 9, receiptHash: "x" }]);
  assert.equal(summary.proposed, 1);
  assert.equal(summary.mergeRate, 1);
});

test("divides net spend by useful answers, using the latest quality update", () => {
  const rows = [
    { status: "settled", receiptHash: "a", amountUsdc: 0.25, attemptId: "a:1", resultStatus: "unchecked" },
    { status: "settled", receiptHash: "b", amountUsdc: 0.75, attemptId: "b:1", resultStatus: "unchecked" },
    { kind: "attempt", attemptId: "a:1", state: "delivered", resultStatus: "useful" },
  ];
  assert.equal(outcomeSummary(rows).useful, 1);
  assert.equal(outcomeSummary(rows).costPerUsefulAnswer, 1);
});

test("totals escrow credits and refused quotes by each attempt's final state", () => {
  const attempt = (attemptId, state, quotedAmountUsdc) => ({ kind: "attempt", attemptId, state, quotedAmountUsdc });
  const rows = [
    attempt("x:1", "reserved"), attempt("x:1", "request_sent", 0.25), attempt("x:1", "failed_and_credited"),
    attempt("y:1", "reserved"), attempt("y:1", "quote_refused", 2),
    // failed and credited, then a later row for the same attempt: only the latest state counts
    attempt("z:1", "request_sent", 0.5), attempt("z:1", "failed_and_credited"), attempt("z:1", "unknown_needs_reconciliation"),
    attempt("w:1", "request_sent", 0.125), attempt("w:1", "failed_not_charged"),
  ];
  const summary = outcomeSummary(rows);
  assert.deepEqual(summary.escrowCredits, { count: 1, amountUsdc: 0.25 });
  assert.deepEqual(summary.refusedQuotes, { count: 1, amountUsdc: 2 });
});

test("keeps only rows dated inside the event window", () => {
  const rows = [{ timestamp: "2026-10-31T23:59:59.000Z" }, { timestamp: "2026-11-01T00:00:00.000Z" },
    { timestamp: "2026-12-01T23:59:59.000Z" }, { timestamp: "2026-12-02T00:00:00.000Z" }, {}];
  assert.deepEqual(inWindow(rows, EVENT_WINDOW).map((row) => row.timestamp),
    ["2026-11-01T00:00:00.000Z", "2026-12-01T23:59:59.000Z"]);
});

test("counts an attempt reconciled as failed_and_charged as spend, using its latest state", () => {
  const purchase = { repo: "r", status: "settled", receiptHash: "a", amountUsdc: 0.25 };
  const charged = { kind: "attempt", attemptId: "x:1", state: "failed_and_charged", chargedAmountUsdc: 0.5, reconciledBy: "dev" };
  const rows = [purchase, { kind: "attempt", attemptId: "x:1", state: "request_sent", quotedAmountUsdc: 0.125 }, charged,
    { kind: "attempt", attemptId: "y:1", state: "request_sent", quotedAmountUsdc: 1 }]; // still open: not spend
  assert.deepEqual(chargedWithoutAnswer(rows), { count: 1, amountUsdc: 0.5 });
  assert.equal(mergedCosts(rows).netSpend, 0.75);
  assert.deepEqual(outcomeSummary(rows).chargedWithoutAnswer, { count: 1, amountUsdc: 0.5 });
  assert.equal(outcomeSummary(rows).escrowCredits.count, 0);
});

// Minimal RFC 4180 reader for the tests: quoted fields, doubled quotes, CRLF lines.
const parseCsv = (text) => {
  const lines = [];
  let line = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { line.push(cell); cell = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { line.push(cell); lines.push(line); line = []; cell = ""; i++; }
    else cell += c;
  }
  return lines;
};
const asObjects = (csv) => {
  const [header, ...lines] = parseCsv(csv);
  return lines.map((line) => Object.fromEntries(header.map((key, i) => [key, line[i]])));
};

test("exports one line per settled purchase with its links, quality and PR outcome", () => {
  const purchase = (receiptHash, timestamp, extra = {}) => ({ repo: "team/repo", status: "settled", receiptHash, timestamp,
    package: "zod", currentVersion: "3.25.0", targetVersion: "4.6.7", intent: "QUESTION_ANSWERING_GENERAL",
    minerId: "7314", minerName: "Migration", selectedBy: "our_choice", minerRank: null, amountUsdc: 0.01,
    network: "eip155:11155111", signalHash: `sig-${receiptHash}`, txHash: `0x${receiptHash}`,
    explorerBaseUrl: "https://sepolia.etherscan.io", attemptId: `${receiptHash}:1`, resultStatus: "unchecked", ...extra });
  const rows = [
    purchase("b", "2026-11-05T00:00:00.000Z"),
    purchase("a", "2026-11-03T00:00:00.000Z"),
    purchase("c", "2026-11-07T00:00:00.000Z"),
    { ...purchase("failed", "2026-11-04T00:00:00.000Z"), status: "failed" },
    { kind: "attempt", attemptId: "a:1", state: "delivered", resultStatus: "useful" },
    { kind: "proposal", repo: "team/repo", prNumber: 11, receiptHash: "a" },
    { kind: "closed", repo: "team/repo", prNumber: 11, receiptHash: "a" },
    { kind: "merge", repo: "team/repo", prNumber: 11, receiptHash: "a" },
    { kind: "proposal", repo: "team/repo", prNumber: 12, receiptHash: "b" },
  ];
  const out = asObjects(evidenceCsv(rows));
  assert.deepEqual(out.map((row) => [row.receipt_hash, row.pr_number, row.pr_outcome, row.answer_quality]),
    [["a", "11", "merged", "useful"], ["b", "12", "open", "unchecked"], ["c", "", "", "unchecked"]]);
  assert.equal(out[0].record, "purchase");
  assert.equal(out[0].selected_by, "our_choice");
  assert.equal(out[0].signal_url, "https://devnode.telegraphprotocol.com/engine/v1/signal/sig-a");
  assert.equal(out[0].tx_url, "https://sepolia.etherscan.io/tx/0xa");
  assert.equal(out[0].miner_rank, "");
});

test("exports attempts reconciled as charged with no answer, with their transaction and who reconciled", () => {
  const rows = [
    { kind: "attempt", attemptId: "x:1", state: "request_sent", repo: "team/repo", timestamp: "2026-11-06T00:00:00.000Z" },
    { kind: "attempt", attemptId: "x:1", state: "failed_and_charged", repo: "team/repo", minerId: "302",
      chargedAmountUsdc: 0.02, txHash: "0xabc", reconciledBy: "dev", reason: "reconciled: transfer found",
      timestamp: "2026-11-08T00:00:00.000Z" },
  ];
  const [line] = asObjects(evidenceCsv(rows));
  assert.equal(line.record, "charged_no_answer");
  assert.equal(line.amount_usdc, "0.02");
  assert.equal(line.tx_url, "https://sepolia.etherscan.io/tx/0xabc");
  assert.equal(line.note, "reconciled by dev: reconciled: transfer found");
});

test("quotes commas, quotes and newlines, and defuses spreadsheet formulas", () => {
  const rows = [{ status: "settled", receiptHash: "r", timestamp: "2026-11-02T00:00:00.000Z", amountUsdc: 0.01,
    minerName: '=HYPERLINK("http://x","click")', package: "a,b", intent: "line one\nline two" }];
  const csv = evidenceCsv(rows);
  const [line] = asObjects(csv);
  assert.equal(line.miner_name, `'=HYPERLINK("http://x","click")`);
  assert.equal(line.package, "a,b");
  assert.equal(line.intent, "line one\nline two");
  assert.ok(csv.startsWith("record,date,repo,"));
  assert.ok(csv.endsWith("\r\n"));
});

test("has only the header for a ledger with nothing to export", () => {
  assert.equal(parseCsv(evidenceCsv([])).length, 1);
});
