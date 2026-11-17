import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { recordMerge, fetchMergedPr } from "../src/accounting.js";

const directories: string[] = [];
afterEach(() => { for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });
const fixture = (status = "settled", baseBranch = "main") => {
  const directory = mkdtempSync(join(tmpdir(), "merge-cost-"));
  directories.push(directory);
  const path = join(directory, "ledger.jsonl");
  const paid = { repo: "team/repo", package: "foo", source: "package.json", currentVersion: "1.0.0",
    targetVersion: "2.0.0", receiptHash: "receipt", status, amountUsdc: 0.01 };
  const detail = { ...paid, ecosystem: "npm", purchase: { receiptHash: "receipt" } };
  const branch = createHash("sha256").update(JSON.stringify([baseBranch, "npm", paid.source, paid.package,
    paid.currentVersion, paid.targetVersion])).digest("hex").slice(0, 24);
  let remote = `${JSON.stringify(paid)}\n`;
  writeFileSync(path, remote);
  const runGit = vi.fn(async (args: string[]) => {
    if (args[0] === "checkout") writeFileSync(path, remote);
    if (args[0] === "push") remote = readFileSync(path, "utf8");
  });
  const pr = { number: 42, merged: true, merged_at: "2026-11-08T00:00:00Z", merge_commit_sha: "b".repeat(40),
    body: `Miner finding and purchase evidence:\n\n${JSON.stringify(detail, null, 2).split("\n").map((l) => `    ${l}`).join("\n")}\n\nDraft for human review.\n\nSpend and receipts for this repository: https://telegraph-pr-agent.vercel.app/?repo=team/repo`,
    base: { ref: baseBranch, repo: { full_name: "team/repo", default_branch: "main" } },
    head: { ref: `fix/telegraph-dependency-${branch}`, sha: "a".repeat(40), repo: { full_name: "team/repo" } } };
  return { ledger: { directory, runGit }, pr, rows: () => remote.trim().split("\n").map((l) => JSON.parse(l)) };
};

it("links a merged generated PR to a settled receipt exactly once", async () => {
  const f = fixture();
  await recordMerge(f.ledger, "team/repo", f.pr);
  await recordMerge(f.ledger, "team/repo", f.pr);
  expect(f.rows()).toHaveLength(2);
  expect(f.rows()[1]).toMatchObject({ kind: "merge", prNumber: 42, repo: "team/repo", receiptHash: "receipt" });
  expect(f.ledger.runGit.mock.calls.filter(([args]) => args[0] === "push")).toHaveLength(1);
});

it("ignores still-open and fork PRs", async () => {
  const f = fixture();
  await recordMerge(f.ledger, "team/repo", { ...f.pr, merged: false, closed_at: null });
  await recordMerge(f.ledger, "team/repo", { ...f.pr, head: { ...f.pr.head, repo: { full_name: "fork/repo" } } });
  expect(f.ledger.runGit).not.toHaveBeenCalled();
});

const closed = (pr: ReturnType<typeof fixture>["pr"]) =>
  ({ ...pr, merged: false, merged_at: null, merge_commit_sha: null, closed_at: "2026-11-09T00:00:00Z" });

it("records a PR closed without merging exactly once, keeping its receipt", async () => {
  const f = fixture();
  await recordMerge(f.ledger, "team/repo", closed(f.pr));
  await recordMerge(f.ledger, "team/repo", closed(f.pr));
  expect(f.rows()).toHaveLength(2);
  expect(f.rows()[1]).toMatchObject({ kind: "closed", prNumber: 42, receiptHash: "receipt", closedAt: "2026-11-09T00:00:00Z" });
});

it("does not record a close for a PR already merged, but records a merge after a close", async () => {
  const merged = fixture();
  await recordMerge(merged.ledger, "team/repo", merged.pr);
  await recordMerge(merged.ledger, "team/repo", closed(merged.pr));
  expect(merged.rows().map((row) => row.kind)).toEqual([undefined, "merge"]);

  const reopened = fixture();
  await recordMerge(reopened.ledger, "team/repo", closed(reopened.pr));
  await recordMerge(reopened.ledger, "team/repo", reopened.pr);
  expect(reopened.rows().map((row) => row.kind)).toEqual([undefined, "closed", "merge"]);
});

it("rejects a closed event without a valid close time", async () => {
  const f = fixture();
  await expect(recordMerge(f.ledger, "team/repo", { ...closed(f.pr), closed_at: "not-a-date" }))
    .rejects.toThrow("Invalid closed PR event");
});

it("rejects forged receipt claims and mismatched generated branches without ledger writes", async () => {
  const f = fixture();
  await expect(recordMerge(f.ledger, "team/repo", { ...f.pr,
    body: f.pr.body.replaceAll('"receipt"', '"other-receipt"') })).rejects.toThrow(/does not match/);
  await expect(recordMerge(f.ledger, "team/repo", { ...f.pr,
    head: { ...f.pr.head, ref: "fix/telegraph-dependency-wrong" } })).rejects.toThrow(/branch differs/);
  expect(f.ledger.runGit.mock.calls.some(([args]) => args[0] === "push")).toBe(false);
});

it("records a default-branch merge with the branch it landed on", async () => {
  const f = fixture();
  expect(await recordMerge(f.ledger, "team/repo", f.pr)).toBe("merged");
  expect(f.rows()[1]).toMatchObject({ kind: "merge", prNumber: 42, baseRef: "main" });
});

it("records release-branch merges when the branch matches merge-branches", async () => {
  const f = fixture("settled", "release/next");
  expect(await recordMerge(f.ledger, "team/repo", f.pr, ["release/*"])).toBe("merged");
  expect(f.rows()[1]).toMatchObject({ kind: "merge", prNumber: 42, baseRef: "release/next" });
});

it("records a merge into any other branch as closed, so it never counts as a merged PR", async () => {
  const f = fixture("settled", "test/readable-changes");
  expect(await recordMerge(f.ledger, "team/repo", f.pr, ["release/*"])).toBe("merged_outside_default_branch");
  expect(f.rows()[1]).toMatchObject({ kind: "closed", prNumber: 42, mergedInto: "test/readable-changes",
    closedAt: "2026-11-08T00:00:00Z" });
  expect(f.rows().some((row) => row.kind === "merge")).toBe(false);
});

it("refuses to count a merge when the default branch is unknown", async () => {
  const f = fixture();
  const pr = { ...f.pr, base: { ref: "main", repo: { full_name: "team/repo" } } };
  await expect(recordMerge(f.ledger, "team/repo", pr)).rejects.toThrow(/default branch/);
  expect(f.ledger.runGit).not.toHaveBeenCalled();
});

it("rejects failed purchase evidence without writing a merge", async () => {
  const f = fixture("failed");
  await expect(recordMerge(f.ledger, "team/repo", f.pr)).rejects.toThrow(/does not match/);
  expect(f.ledger.runGit.mock.calls.some(([args]) => args[0] === "push")).toBe(false);
});

it("reports missing purchase evidence instead of silently omitting merged costs", async () => {
  const f = fixture();
  await expect(recordMerge(f.ledger, "team/repo", { ...f.pr, body: "Edited by maintainer" }))
    .rejects.toThrow(/restore the receipt link/);
  expect(f.ledger.runGit).not.toHaveBeenCalled();
});

it("fetches corrected evidence on rerun and rejects lookup failures", async () => {
  const f = fixture();
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(f.pr)));
  await recordMerge(f.ledger, "team/repo", await fetchMergedPr("team/repo", 42, "token", fetchImpl));
  expect(f.rows()[1]).toMatchObject({ kind: "merge", prNumber: 42 });
  await expect(fetchMergedPr("team/repo", 42, "token", async () => new Response("", { status: 503 }))).rejects.toThrow(/HTTP 503/);
  await expect(fetchMergedPr("team/repo", 43, "token", fetchImpl)).rejects.toThrow(/different PR/);
});

const freeFixture = (proposed = true) => {
  const f = fixture();
  const upgrade = { ecosystem: "npm", package: "foo", source: "package.json", currentVersion: "1.0.0", targetVersion: "2.0.0" };
  const proposal = { kind: "proposal", repo: "team/repo", prNumber: 42, prUrl: "https://github.com/team/repo/pull/42", free: true, ...upgrade };
  // Only the free proposal is on the ledger: no purchase backs this PR.
  const ledgerPath = join(f.ledger.directory, "ledger.jsonl");
  writeFileSync(ledgerPath, proposed ? `${JSON.stringify(proposal)}\n` : "");
  f.ledger.runGit.mockImplementation(async () => {});
  const body = `Upgrade evidence (no purchase):\n\n${JSON.stringify({ ...upgrade, releaseDate: "2024-01-01T00:00:00Z", cutoff: "2025-01-01", free: true }, null, 2)
    .split("\n").map((l) => `    ${l}`).join("\n")}\n\nFor human review.`;
  return { ...f, pr: { ...f.pr, body }, rows: () => readFileSync(ledgerPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
};

it("records a free PR's merge and close against its proposal, with no receipt", async () => {
  const f = freeFixture();
  expect(await recordMerge(f.ledger, "team/repo", f.pr)).toBe("merged");
  await recordMerge(f.ledger, "team/repo", f.pr);
  expect(f.rows()).toHaveLength(2);
  expect(f.rows()[1]).toMatchObject({ kind: "merge", prNumber: 42, free: true, baseRef: "main" });
  expect(f.rows()[1]).not.toHaveProperty("receiptHash");

  const c = freeFixture();
  expect(await recordMerge(c.ledger, "team/repo", closed(c.pr))).toBe("closed");
  expect(c.rows()[1]).toMatchObject({ kind: "closed", prNumber: 42, free: true });
});

it("rejects a free PR without a matching free proposal or with a forged branch", async () => {
  const f = freeFixture(false);
  await expect(recordMerge(f.ledger, "team/repo", f.pr)).rejects.toThrow(/recorded free proposal/);
  const g = freeFixture();
  await expect(recordMerge(g.ledger, "team/repo", { ...g.pr, body: g.pr.body.replace('"2.0.0"', '"3.0.0"') }))
    .rejects.toThrow(/recorded free proposal/);
  await expect(recordMerge(g.ledger, "team/repo", { ...g.pr, head: { ...g.pr.head, ref: "fix/telegraph-dependency-wrong" } }))
    .rejects.toThrow(/branch differs/);
});
