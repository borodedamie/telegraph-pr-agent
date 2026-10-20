import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendLedgerRow,
  commitLedgerRow,
  LEDGER_FILE,
  type LedgerRow,
} from "../src/ledger.js";

const row: LedgerRow = {
  prNumber: 7,
  headSha: "abc123def",
  intent: "QUESTION_ANSWERING",
  minerId: "302",
  minerName: "ChainSight",
  amountUsdc: 0.01,
  txHash: "0xdeadbeef",
  answerPreview: "the answer",
  timestamp: "2026-10-21T00:00:00.000Z",
  status: "settled",
};

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
        "answerPreview",
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

  it("throws after 3 failed push attempts", async () => {
    const git = makeFakeGit({ failPushTimes: 99 });
    await expect(commitLedgerRow(dir, row, { runGit: git.runGit })).rejects.toThrow(/ledger push failed/);
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(3);
  });
});
