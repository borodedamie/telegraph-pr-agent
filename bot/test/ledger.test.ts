import { mkdtempSync, readFileSync, rmSync, symlinkSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendLedgerRow,
  commitLedgerRow,
  AttemptConflictError,
  type AttemptKey,
  DuplicateReceiptError,
  type AttemptRow,
  checkMayPay,
  hasLedgerRow,
  LEDGER_FILE,
  monthToDateSpendUsdc,
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

  it("retries as a new, numbered attempt after any outcome where no money is unaccounted for", () => {
    const rows = ledger(
      at(1, "reserved"),
      at(2, "reserved"),
      at(2, "quote_refused"),
      at(3, "request_sent"),
      at(3, "failed_and_credited"),
      at(4, "request_sent"),
      at(4, "failed_not_charged")
    );
    expect(preflight(rows, key)).toEqual({ action: "buy", nextAttempt: 5 });
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

describe("checkMayPay", () => {
  const key: AttemptKey = { repo: "o/r", prNumber: 9, headSha: "sha9", step: "qa" };
  const at = (attempt: number, state: AttemptRow["state"]): AttemptRow => ({
    kind: "attempt",
    ...key,
    attemptId: `run:${attempt}`,
    attempt,
    state,
    minerId: "148002",
    timestamp: "2026-11-05T00:00:00.000Z",
  });
  const ledger = (...rows: AttemptRow[]) => rows.reduce(appendLedgerRow, "");

  it("allows paying when only this attempt, or finished ones, exist", () => {
    expect(() => checkMayPay(ledger(at(1, "failed_and_credited"), at(2, "reserved")), key, "run:2")).not.toThrow();
  });

  it("refuses when another attempt is mid-payment (a concurrent run got there first)", () => {
    expect(() => checkMayPay(ledger(at(1, "reserved"), at(1, "request_sent"), at(2, "reserved")), key, "run:2")).toThrow(
      AttemptConflictError
    );
  });

  it("refuses when another attempt already delivered", () => {
    expect(() => checkMayPay(ledger(at(1, "delivered")), key, "run:2")).toThrow(/run:1 \(delivered\)/);
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

  it("rejects dangling ledger symlinks before writing outside its checkout", async () => {
    const outside = join(dir, "outside.jsonl");
    symlinkSync(outside, ledgerPath());
    const calls: string[][] = [];
    await expect(commitLedgerRow(dir, row, { runGit: async (args) => { calls.push(args); } }))
      .rejects.toThrow("Ledger must be a regular file");
    expect(existsSync(outside)).toBe(false);
    expect(calls.map((args) => args[0])).toEqual(["fetch", "checkout"]);
  });

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

  it("rebuilds the rows from the fresh ledger on every push retry, and aborts if the build throws", async () => {
    // First fetch: empty ledger, our push loses the race. Second fetch: the other
    // run's row is there, so the build sees it and refuses.
    const remote = ["", "other-run-request-sent\n"];
    let fetches = 0;
    const calls: string[][] = [];
    const runGit = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "fetch") fetches += 1;
      if (args[0] === "checkout") writeFileSync(ledgerPath(), remote[fetches - 1]);
      if (args[0] === "push") throw new Error("rejected (non-fast-forward)");
    };
    const seen: string[] = [];
    const build = (existing: string) => {
      seen.push(existing);
      if (existing.includes("other-run")) throw new AttemptConflictError("another run is paying");
      return row;
    };
    await expect(commitLedgerRow(dir, build, { runGit })).rejects.toBeInstanceOf(AttemptConflictError);
    expect(seen).toEqual(["", "other-run-request-sent\n"]);
    expect(calls.filter((c) => c[0] === "push")).toHaveLength(1); // the refused build never pushes
  });

  it("refuses a purchase whose receipt_hash is already on the ledger, without pushing", async () => {
    const git = makeFakeGit({ remoteContent: `${JSON.stringify(row)}\n` });
    await expect(commitLedgerRow(dir, { ...row, prNumber: 99 }, { runGit: git.runGit })).rejects.toBeInstanceOf(
      DuplicateReceiptError
    );
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(0);
  });

  it("allows a new receipt, and attempt rows that repeat a receipt_hash", async () => {
    const git = makeFakeGit({ remoteContent: `${JSON.stringify(row)}\n` });
    const delivered: AttemptRow = {
      kind: "attempt",
      repo: "o/r",
      prNumber: 7,
      headSha: "abc123def",
      step: "qa",
      attemptId: "a:1",
      attempt: 1,
      state: "delivered",
      minerId: "302",
      receiptHash: row.receiptHash,
      timestamp: "2026-11-05T00:00:00.000Z",
    };
    await commitLedgerRow(dir, [{ ...row, receiptHash: "0xnew" }, delivered], { runGit: git.runGit });
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(1);
  });

  it("throws after 3 failed push attempts", async () => {
    const git = makeFakeGit({ failPushTimes: 99 });
    await expect(commitLedgerRow(dir, row, { runGit: git.runGit })).rejects.toThrow(/ledger push failed/);
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(3);
  });
});

describe("monthToDateSpendUsdc", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");
  const purchase = (timestamp: string, amountUsdc: number, status: LedgerRow["status"] = "settled") =>
    ({ ...row, timestamp, amountUsdc, status, receiptHash: `r-${timestamp}` });
  const attempt = (attemptId: string, state: AttemptRow["state"], timestamp: string): AttemptRow => ({
    kind: "attempt", repo: "o/r", headSha: "sha", step: "qa", attemptId, attempt: 1, state, minerId: "1", timestamp,
  });
  const ledger = (...rows: (LedgerRow | AttemptRow)[]) => rows.reduce(appendLedgerRow, "");

  it("adds settled purchases dated in the current UTC month only", () => {
    const rows = ledger(
      purchase("2026-10-31T23:59:59.999Z", 4), // last month
      purchase("2026-11-01T00:00:00.000Z", 0.25),
      purchase("2026-11-30T23:59:59.999Z", 0.5),
      purchase("2026-12-01T00:00:00.000Z", 8), // next month
      purchase("2026-11-10T00:00:00.000Z", 16, "failed")
    );
    expect(monthToDateSpendUsdc(rows, now, 0.1)).toBe(0.75);
  });

  it("counts an attempt still mid-payment at the worst case, and nothing for reserved or finished ones", () => {
    const rows = ledger(
      attempt("a:1", "reserved", "2026-11-02T00:00:00.000Z"),
      attempt("a:1", "request_sent", "2026-11-02T00:00:01.000Z"), // open
      attempt("b:1", "request_sent", "2026-11-03T00:00:00.000Z"),
      attempt("b:1", "unknown_needs_reconciliation", "2026-11-03T00:00:01.000Z"), // open
      attempt("c:1", "request_sent", "2026-11-04T00:00:00.000Z"),
      attempt("c:1", "failed_not_charged", "2026-11-04T00:00:01.000Z"),
      attempt("d:1", "reserved", "2026-11-05T00:00:00.000Z"),
      attempt("e:1", "request_sent", "2026-10-20T00:00:00.000Z") // open, but last month
    );
    expect(monthToDateSpendUsdc(rows, now, 0.25)).toBe(0.5);
  });

  it("is zero for an empty ledger", () => {
    expect(monthToDateSpendUsdc("", now, 0.1)).toBe(0);
  });

  it("counts a reconciled failed_and_charged attempt at its charged amount", () => {
    const rows = ledger(
      attempt("f:1", "request_sent", "2026-11-06T00:00:00.000Z"),
      { ...attempt("f:1", "failed_and_charged", "2026-11-06T01:00:00.000Z"), chargedAmountUsdc: 0.5, reconciledBy: "dev" }
    );
    expect(monthToDateSpendUsdc(rows, now, 0.1)).toBe(0.5);
  });
});
