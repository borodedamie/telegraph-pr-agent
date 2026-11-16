import { createHash } from "node:crypto";
import { matchesGlob } from "node:path";
import {
  commitLedgerRow,
  type ClosedRow,
  type LedgerRow,
  type MergeRow,
} from "./ledger.js";
import { FREE_EVIDENCE_MARKER, PAID_EVIDENCE_MARKER } from "./pull-request.js";
import type { Ledger } from "./purchase.js";

export interface MergedPr {
  number: number;
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  closed_at?: string | null;
  body: string;
  base: { ref: string; repo: { full_name: string; default_branch?: string } };
  head: { ref: string; sha: string; repo: { full_name: string } };
}

export type PrOutcome =
  | "merged"
  | "merged_outside_default_branch"
  | "closed"
  | "ignored";

/**
 * Record how a generated dependency PR ended. A merge counts only into the repository's default
 * branch or a branch matching `countedBranches` (globs such as "release/*", for teams that ship
 * from release branches). A merge anywhere else (a test or feature branch) is recorded as closed,
 * so its spend stays unmerged and cost per merged PR is never inflated by it.
 */
export const recordMerge = async (
  ledger: Ledger,
  repository: string,
  pr: MergedPr,
  countedBranches: string[] = [],
): Promise<PrOutcome> => {
  if (
    pr.base.repo.full_name !== repository ||
    pr.head.repo.full_name !== repository ||
    !pr.head.ref.startsWith("fix/telegraph-dependency-")
  )
    return "ignored";
  if (!pr.merged && !pr.closed_at) return "ignored"; // still open: nothing to record yet
  const listed = countedBranches.some((pattern) =>
    matchesGlob(pr.base.ref, pattern),
  );
  const defaultBranch = pr.base.repo.default_branch;
  if (pr.merged && !listed && !defaultBranch)
    throw new Error(
      `Cannot confirm the default branch for PR #${pr.number}; merge not recorded`,
    );
  const counted = pr.merged && (listed || pr.base.ref === defaultBranch);
  const closedAt = pr.closed_at ?? pr.merged_at;
  // A free PR (pre-cutoff upgrade, nothing bought) carries its own marker and is anchored to its
  // proposal row instead of a purchase; it never joins cost per merged PR.
  const free = !pr.body?.includes(PAID_EVIDENCE_MARKER) && !!pr.body?.includes(FREE_EVIDENCE_MARKER);
  const evidence = pr.body
    ?.split(free ? FREE_EVIDENCE_MARKER : PAID_EVIDENCE_MARKER)[1]
    ?.split("\n\n")[0];
  if (!evidence)
    throw new Error(
      `PR #${pr.number} is missing purchase evidence; restore the receipt link and rerun merge accounting`,
    );
  const detail = JSON.parse(
    evidence
      .split("\n")
      .map((line) => line.replace(/^    /, ""))
      .join("\n"),
  );
  if (
    !free &&
    (typeof detail.purchase?.receiptHash !== "string" ||
      !detail.purchase.receiptHash)
  ) {
    throw new Error(
      "Purchase receipt is missing; reconcile the paid assessment before merge accounting",
    );
  }
  if (
    !Number.isSafeInteger(pr.number) ||
    pr.number <= 0 ||
    !/^[a-f0-9]{40}$/.test(pr.head.sha) ||
    (counted
      ? !/^[a-f0-9]{40}$/.test(pr.merge_commit_sha ?? "") ||
        !Number.isFinite(Date.parse(pr.merged_at ?? ""))
      : !Number.isFinite(Date.parse(closedAt ?? "")))
  ) {
    throw new Error(
      counted ? "Invalid merged PR event" : "Invalid closed PR event",
    );
  }
  await commitLedgerRow(
    ledger.directory,
    (fresh) => {
      const rows = fresh
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      const sameUpgrade = (row: Record<string, unknown>) =>
        row.repo === repository &&
        row.package === detail.package &&
        row.source === detail.source &&
        row.currentVersion === detail.currentVersion &&
        row.targetVersion === detail.targetVersion;
      const anchor: LedgerRow | undefined = free
        ? rows.find(
            (row) =>
              row.kind === "proposal" &&
              row.free === true &&
              row.prNumber === pr.number &&
              sameUpgrade(row),
          )
        : rows.find(
            (row) =>
              !row.kind &&
              row.receiptHash === detail.purchase?.receiptHash &&
              row.status === "settled" &&
              sameUpgrade(row),
          );
      if (!anchor)
        throw new Error(
          free
            ? "PR evidence does not match a recorded free proposal"
            : "PR evidence does not match a recorded purchase",
        );
      const receipt = free ? { free: true as const } : { receiptHash: anchor.receiptHash };
      const identity = createHash("sha256")
        .update(
          JSON.stringify([
            pr.base.ref,
            detail.ecosystem,
            anchor.source,
            anchor.package,
            anchor.currentVersion,
            anchor.targetVersion,
          ]),
        )
        .digest("hex")
        .slice(0, 24);
      if (pr.head.ref !== `fix/telegraph-dependency-${identity}`)
        throw new Error("PR branch differs from purchase identity");
      const merged = rows.some(
        (row) =>
          row.kind === "merge" &&
          row.repo === repository &&
          (row.prNumber === pr.number ||
            (!free && row.receiptHash === anchor.receiptHash)),
      );
      if (!counted) {
        // A merge outranks a close; the same close seen twice (a rerun) is recorded once.
        if (
          merged ||
          rows.some(
            (row) =>
              row.kind === "closed" &&
              row.repo === repository &&
              row.prNumber === pr.number &&
              row.headSha === pr.head.sha,
          )
        )
          return [];
        const row: ClosedRow = {
          kind: "closed",
          repo: repository,
          prNumber: pr.number,
          headSha: pr.head.sha,
          ...receipt,
          closedAt: closedAt!,
          ...(pr.merged ? { mergedInto: pr.base.ref } : {}),
          timestamp: new Date().toISOString(),
        };
        return row;
      }
      if (merged) return [];
      const row: MergeRow = {
        kind: "merge",
        repo: repository,
        prNumber: pr.number,
        headSha: pr.head.sha,
        mergeSha: pr.merge_commit_sha!,
        ...receipt,
        mergedAt: pr.merged_at!,
        baseRef: pr.base.ref,
        timestamp: new Date().toISOString(),
      };
      return row;
    },
    ledger,
  );
  return counted
    ? "merged"
    : pr.merged
      ? "merged_outside_default_branch"
      : "closed";
};

/** Fetch current evidence so an edited PR body is recoverable on a workflow rerun. */
export const fetchMergedPr = async (
  repository: string,
  number: number,
  token: string,
  fetchImpl = fetch,
): Promise<MergedPr> => {
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error("Invalid merge PR number");
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/pulls/${number}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(`Merge PR lookup failed: HTTP ${response.status}`);
  const pr = (await response.json()) as MergedPr;
  if (pr.number !== number)
    throw new Error("Merge PR lookup returned a different PR");
  return pr;
};
