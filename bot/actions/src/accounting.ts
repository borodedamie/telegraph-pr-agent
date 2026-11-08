import { createHash } from "node:crypto";
import { commitLedgerRow, type LedgerRow, type MergeRow } from "../../src/ledger.js";
import type { Ledger } from "./purchase";

export interface MergedPr {
  number: number;
  merged: boolean;
  merged_at: string;
  merge_commit_sha: string;
  body: string;
  base: { ref: string; repo: { full_name: string } };
  head: { ref: string; sha: string; repo: { full_name: string } };
}

export const recordMerge = async (ledger: Ledger, repository: string, pr: MergedPr): Promise<void> => {
  if (!pr.merged || pr.base.repo.full_name !== repository || pr.head.repo.full_name !== repository
    || !pr.head.ref.startsWith("fix/telegraph-dependency-")) return;
  const evidence = pr.body?.split("Miner finding and purchase evidence:\n\n")[1]?.split("\n\n")[0];
  if (!evidence) throw new Error(`PR #${pr.number} is missing purchase evidence; restore the receipt link and rerun merge accounting`);
  const detail = JSON.parse(evidence.split("\n").map((line) => line.replace(/^    /, "")).join("\n"));
  if (typeof detail.purchase?.receiptHash !== "string" || !detail.purchase.receiptHash) {
    throw new Error("Purchase receipt is missing; reconcile the paid assessment before merge accounting");
  }
  if (!Number.isSafeInteger(pr.number) || pr.number <= 0 || !/^[a-f0-9]{40}$/.test(pr.merge_commit_sha)
    || !/^[a-f0-9]{40}$/.test(pr.head.sha) || !Number.isFinite(Date.parse(pr.merged_at))) {
    throw new Error("Invalid merged PR event");
  }
  await commitLedgerRow(ledger.directory, (fresh) => {
    const rows = fresh.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    const paid: LedgerRow | undefined = rows.find((row) => !row.kind && row.repo === repository
      && row.receiptHash === detail.purchase?.receiptHash && row.status === "settled"
      && row.package === detail.package && row.source === detail.source
      && row.currentVersion === detail.currentVersion && row.targetVersion === detail.targetVersion);
    if (!paid) throw new Error("Merged PR evidence does not match a recorded purchase");
    const identity = createHash("sha256").update(JSON.stringify([
      pr.base.ref, detail.ecosystem, paid.source, paid.package, paid.currentVersion, paid.targetVersion,
    ])).digest("hex").slice(0, 24);
    if (pr.head.ref !== `fix/telegraph-dependency-${identity}`) throw new Error("Merged PR branch differs from purchase identity");
    if (rows.some((row) => row.kind === "merge" && row.repo === repository
      && (row.prNumber === pr.number || row.receiptHash === paid.receiptHash))) return [];
    const row: MergeRow = { kind: "merge", repo: repository, prNumber: pr.number,
      headSha: pr.head.sha, mergeSha: pr.merge_commit_sha, receiptHash: paid.receiptHash,
      mergedAt: pr.merged_at, timestamp: new Date().toISOString() };
    return row;
  }, ledger);
};
