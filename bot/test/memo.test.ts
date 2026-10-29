import { describe, expect, it } from "vitest";
import { MEMO_MARKER, renderMemo } from "../src/memo.js";
import type { LedgerRow } from "../src/ledger.js";

const row: LedgerRow = {
  prNumber: 7,
  headSha: "abc123def",
  intent: "QUESTION_ANSWERING",
  minerId: "302",
  minerName: "ChainSight — On-Chain Intelligence Hub",
  amountUsdc: 0.01,
  txHash: "0xdeadbeef",
  receiptHash: "0xreceipt",
  signalHash: "0xsignal",
  minerRank: 1,
  minerScore: 0.9,
  answer: "the answer",
  timestamp: "2026-10-22T18:08:11.002Z",
  status: "settled",
};

const opts = { prNumber: 7, dashboardUrl: "https://example.test/dash" };

describe("renderMemo", () => {
  it("stamps the sticky marker and the boundary line verbatim", () => {
    const memo = renderMemo([row], opts);
    expect(memo.startsWith(MEMO_MARKER)).toBe(true);
    expect(memo).toContain(
      "Testnet build. Routing, miners, verification and settlement are real; USDC is testnet-denominated. No revenue claim is made."
    );
  });

  it("summarises settled count, USDC paid and failures", () => {
    const failed: LedgerRow = { ...row, status: "failed", txHash: "", answer: "nope" };
    const memo = renderMemo([row, row, failed], opts);
    expect(memo).toContain("2 SETTLED");
    expect(memo).toContain("0.02 USDC PAID");
    expect(memo).toContain("1 FAILED");
  });

  it("reads each settled receipt as a paid sentence with quote and payment link", () => {
    const memo = renderMemo([row], opts);
    // Key phrases are emphasised the way the sample receipt reads out loud.
    expect(memo).toContain(
      "Paid **0.01 USDC** to **ChainSight — On-Chain Intelligence Hub** for **QUESTION ANSWERING** on **PR #7**."
    );
    expect(memo).toContain("> the answer");
    expect(memo).toContain("https://sepolia.basescan.org/tx/0xdeadbeef");
    expect(memo).toContain("View payment");
  });

  it("keeps the audit fields in the receipt footer", () => {
    const memo = renderMemo([row], opts);
    expect(memo).toContain("settled");
    expect(memo).toContain("2026-10-22 18:08 UTC");
    expect(memo).toContain("302");
  });

  it("reads a failed receipt as a payment that did not go through, without a payment link", () => {
    const failed: LedgerRow = { ...row, status: "failed", txHash: "", answer: "nope" };
    const memo = renderMemo([failed], opts);
    expect(memo).toContain("didn’t go through");
    expect(memo).not.toContain("View payment");
    expect(memo).toContain("failed");
  });

  it("sends readers to the dashboard for the full entry details", () => {
    const memo = renderMemo([row], opts);
    expect(memo).toContain("https://example.test/dash");
  });

  it("quotes a multi-line answer in full, every line inside the blockquote", () => {
    const long: LedgerRow = { ...row, answer: "line one\nline two" };
    expect(renderMemo([long], opts)).toContain("> line one\n> line two");
  });
});
