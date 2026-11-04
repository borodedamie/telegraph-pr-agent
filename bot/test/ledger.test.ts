import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendLedgerRow,
  commitLedgerRow,
  type AttemptKey,
  type AttemptRow,
  hasLedgerRow,
  LEDGER_FILE,
  type LedgerRow,
  preflight,
} from "../src/ledger.js";

const row: LedgerRow = {
  prNumber: 7,
  headSha: "abc123def",
  intent: "QUESTION_ANSWERING",
  minerId: "302",
  minerName: "ChainSight",
  amountUsdc: 0.01,
  txHash: "0xdeadbeef",
  receiptHash: "0xreceipt",
  signalHash: "0xsignal",
  minerRank: 1,
  minerScore: 0.9,
  answer: "the answer",
  timestamp: "2026-10-21T00:00:00.000Z",
  status: "settled",
};

describe("hasLedgerRow", () => {
  it("finds an existing row for the same PR and head SHA", () => {
    expect(hasLedgerRow(appendLedgerRow("", row), row.prNumber, row.headSha)).toBe(true);
  });

  it("returns false when the head SHA differs (re-pushed PR must re-buy)", () => {
    expect(hasLedgerRow(appendLedgerRow("", row), row.prNumber, "different-sha")).toBe(false);
  });

  it("returns false when the PR number differs", () => {
    expect(hasLedgerRow(appendLedgerRow("", row), 8, row.headSha)).toBe(false);
  });

  it("returns false for an empty ledger and tolerates malformed lines", () => {
    expect(hasLedgerRow("", row.prNumber, row.headSha)).toBe(false);
    expect(hasLedgerRow("not-json\n", row.prNumber, row.headSha)).toBe(false);
  });

  it("finds the row anywhere in the ledger, not just the last line", () => {
    const older: LedgerRow = { ...row, prNumber: 6, headSha: "oldsha" };
    const existing = appendLedgerRow(appendLedgerRow("", older), row);
    expect(hasLedgerRow(existing, older.prNumber, older.headSha)).toBe(true);
  });
});

describe("preflight", () => {
  const key: AttemptKey = { repo: "o/r", prNumber: 9, headSha: "sha9", step: "qa" };
  const at = (attempt: number, state: AttemptRow["state"], over: Partial<AttemptRow> = {}): AttemptRow => ({
    kind: "attempt",
    ...key,
    attemptId: `o/r#9@sha9:qa:${attempt}`,
    attempt,
    state,
    minerId: "148002",
    timestamp: "2026-11-04T00:00:00.000Z",
    ...over,
  });
  const ledger = (...rows: (LedgerRow | AttemptRow)[]) => rows.reduce(appendLedgerRow, "");

  it("buys attempt 1 on an empty ledger", () => {
    expect(preflight("", key)).toEqual({ action: "buy", nextAttempt: 1 });
  });

  it("halts when the process died after request_sent (we may have paid)", () => {
    const p = preflight(ledger(at(1, "reserved"), at(1, "request_sent")), key);
    expect(p.action).toBe("halt");
    expect(p).toMatchObject({ reason: expect.stringContaining("o/r#9@sha9:qa:1 (request_sent)") });
  });

  it("halts on unknown_needs_reconciliation", () => {
    expect(preflight(ledger(at(1, "request_sent"), at(1, "unknown_needs_reconciliation")), key).action).toBe("halt");
  });

  it("skips once an attempt is delivered", () => {
    expect(preflight(ledger(at(1, "request_sent"), at(1, "delivered")), key).action).toBe("skip");
  });

  it("retries as a new, numbered attempt after reserved-only or failed_and_credited", () => {
    const rows = ledger(at(1, "reserved"), at(2, "request_sent"), at(2, "failed_and_credited"));
    expect(preflight(rows, key)).toEqual({ action: "buy", nextAttempt: 3 });
  });

  it("ignores attempts for another repo, PR, SHA or step", () => {
    const rows = ledger(
      at(1, "request_sent", { repo: "x/y" }),
      at(1, "request_sent", { prNumber: 10 }),
      at(1, "request_sent", { headSha: "other" }),
      at(1, "request_sent", { step: "fix" })
    );
    expect(preflight(rows, key)).toEqual({ action: "buy", nextAttempt: 1 });
  });

  it("skips when a pre-attempt purchase row exists for the PR and SHA", () => {
    expect(preflight(ledger({ ...row, prNumber: 9, headSha: "sha9" }), key).action).toBe("skip");
  });

  it("does not mistake an attempt row for a purchase in hasLedgerRow", () => {
    expect(hasLedgerRow(ledger(at(1, "reserved")), 9, "sha9")).toBe(false);
  });
});

describe("appendLedgerRow", () => {
  it("appends the row as exactly one JSON line to existing content", () => {
    const out = appendLedgerRow("", row);
    expect(out).toBe(`${JSON.stringify(row)}\n`);
    const out2 = appendLedgerRow("existing\n", row);
    expect(out2).toBe(`existing\n${JSON.stringify(row)}\n`);
  });

  it("writes the fixed schema keys — no extras, no omissions", () => {
    const line = appendLedgerRow("", row).trim();
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(
      [
        "amountUsdc",
        "answer",
        "minerRank",
        "minerScore",
        "receiptHash",
        "signalHash",
        "headSha",
        "intent",
        "minerId",
        "minerName",
        "prNumber",
        "status",
        "timestamp",
        "txHash",
      ].sort()
    );
  });
});

describe("commitLedgerRow", () => {
  let dir: string;
  const ledgerPath = () => join(dir, LEDGER_FILE);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ledger-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeFakeGit(opts: { remoteContent?: string; failPushTimes?: number } = {}) {
    const calls: string[][] = [];
    let pushFails = opts.failPushTimes ?? 0;
    const runGit = async (args: string[]): Promise<void> => {
      calls.push(args);
      if (args[0] === "checkout") {
        // simulate checkout -B ledger origin/ledger: worktree reset to remote content
        writeFileSync(ledgerPath(), opts.remoteContent ?? "");
      }
      if (args[0] === "push" && pushFails > 0) {
        pushFails -= 1;
        throw new Error("rejected (non-fast-forward)");
      }
    };
    return { calls, runGit };
  }

  it("fetches, checks out the ledger branch, appends, commits and pushes", async () => {
    const git = makeFakeGit({ remoteContent: "prior-row\n" });
    await commitLedgerRow(dir, row, { runGit: git.runGit });

    const verbs = git.calls.map((c) => c[0]);
    expect(verbs).toEqual(["fetch", "checkout", "add", "commit", "push"]);
    expect(git.calls[0]).toEqual(["fetch", "origin", "ledger"]);
    expect(git.calls[1]).toEqual(["checkout", "-B", "ledger", "origin/ledger"]);
    expect(git.calls[4]).toEqual(["push", "origin", "ledger"]);
    expect(readFileSync(ledgerPath(), "utf8")).toBe(`prior-row\n${JSON.stringify(row)}\n`);
  });

  it("rebases and retries when the push is rejected, succeeding within 3 attempts", async () => {
    const git = makeFakeGit({ failPushTimes: 2 });
    await commitLedgerRow(dir, row, { runGit: git.runGit });
    const pushes = git.calls.filter((c) => c[0] === "push");
    expect(pushes).toHaveLength(3);
    // final worktree content has the row exactly once (checkout reset each attempt)
    const lines = readFileSync(ledgerPath(), "utf8").trim().split("\n");
    expect(lines).toEqual([JSON.stringify(row)]);
  });

  it("writes several rows in one commit", async () => {
    const git = makeFakeGit();
    const second: LedgerRow = { ...row, receiptHash: "0xother" };
    await commitLedgerRow(dir, [row, second], { runGit: git.runGit });
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    expect(readFileSync(ledgerPath(), "utf8")).toBe(`${JSON.stringify(row)}\n${JSON.stringify(second)}\n`);
  });

  it("throws after 3 failed push attempts", async () => {
    const git = makeFakeGit({ failPushTimes: 99 });
    await expect(commitLedgerRow(dir, row, { runGit: git.runGit })).rejects.toThrow(/ledger push failed/);
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(3);
  });
});
