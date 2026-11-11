/** The latest row of each attempt, keyed by attemptId. */
const latestAttempts = (rows) => {
  const latest = new Map();
  for (const row of rows.filter((row) => row.kind === "attempt" && row.attemptId)) latest.set(row.attemptId, row);
  return latest;
};

/** Attempts reconciled as charged with no answer kept: real spend with no purchase row. */
export const chargedWithoutAnswer = (rows) => {
  const charged = [...latestAttempts(rows).values()].filter((row) => row.state === "failed_and_charged");
  return { count: charged.length, amountUsdc: charged.reduce((sum, row) => sum + (row.chargedAmountUsdc ?? 0), 0) };
};

/** Keep receipt-linked allocation separate from all recorded net spending per merged PR. */
export const mergedCosts = (rows) => {
  const purchases = new Map(rows.filter((row) => !row.kind && row.status === "settled" && row.receiptHash)
    .map((row) => [row.receiptHash, row]));
  const prs = new Set();
  const receipts = new Set();
  let total = 0;
  for (const row of rows.filter((row) => row.kind === "merge")) {
    const purchase = purchases.get(row.receiptHash);
    if (!purchase || purchase.repo !== row.repo || receipts.has(row.receiptHash)) continue;
    receipts.add(row.receiptHash);
    prs.add(`${row.repo}#${row.prNumber}`);
    total += purchase.amountUsdc;
  }
  const settled = new Map(rows.filter((row) => !row.kind && row.status === "settled")
    .map((row, index) => [row.receiptHash || row.attemptId || `unlinked:${index}`, row]));
  const netSpend = [...settled.values()].reduce((sum, row) => sum + row.amountUsdc, 0) + chargedWithoutAnswer(rows).amountUsdc;
  return { total, count: prs.size, average: prs.size ? total / prs.size : null,
    netSpend, unmergedSpend: netSpend - total, costPerMergedPr: prs.size ? netSpend / prs.size : null };
};

/** Project the latest quality update only onto its matching payment attempt. */
export const purchaseRows = (rows) => {
  const quality = new Map(rows.filter((row) => row.kind === "attempt" && row.attemptId && row.resultStatus)
    .map((row) => [row.attemptId, row.resultStatus]));
  return rows.filter((row) => !row.kind).map((row) => ({ ...row,
    resultStatus: quality.get(row.attemptId) ?? row.resultStatus }));
};

/** The event window for hackathon evidence (SPEC §5): 1 Nov – 1 Dec 2026 inclusive, UTC. */
export const EVENT_WINDOW = { from: "2026-11-01T00:00:00.000Z", to: "2026-12-02T00:00:00.000Z", label: "1 Nov – 1 Dec 2026" };

/** Rows dated inside [from, to). Rows without a timestamp are left out of a dated figure. */
export const inWindow = (rows, { from, to }) =>
  rows.filter((row) => typeof row.timestamp === "string" && row.timestamp >= from && row.timestamp < to);

/**
 * PR outcomes, answer quality and money that never became spend (SPEC §4.3).
 * Proposed PRs count every PR seen in a proposal, merge or close row, so PRs opened
 * before proposal rows existed still count. A merge outranks a close.
 */
export const outcomeSummary = (rows) => {
  const pr = (row) => `${row.repo}#${row.prNumber}`;
  const merged = new Set(rows.filter((row) => row.kind === "merge").map(pr));
  const closed = new Set(rows.filter((row) => row.kind === "closed").map(pr).filter((key) => !merged.has(key)));
  const proposed = new Set([...rows.filter((row) => row.kind === "proposal").map(pr), ...merged, ...closed]);

  const purchases = new Map(rows.filter((row) => !row.kind && row.status === "settled" && row.receiptHash)
    .map((row) => [row.receiptHash, row]));
  const closedReceipts = new Set(rows.filter((row) => row.kind === "closed" && closed.has(pr(row))).map((row) => row.receiptHash));
  const closedSpend = [...closedReceipts].reduce((sum, receipt) => sum + (purchases.get(receipt)?.amountUsdc ?? 0), 0);

  const settled = purchaseRows(rows).filter((row) => row.status === "settled");
  const netSpend = settled.reduce((sum, row) => sum + row.amountUsdc, 0) + chargedWithoutAnswer(rows).amountUsdc;
  const useful = settled.filter((row) => row.resultStatus === "useful").length;

  // An attempt's amount is on its request_sent or quote_refused row; its outcome is its latest row.
  const quoted = new Map();
  for (const row of rows.filter((row) => row.kind === "attempt" && typeof row.quotedAmountUsdc === "number")) {
    quoted.set(row.attemptId, row.quotedAmountUsdc);
  }
  const ended = (state) => [...latestAttempts(rows).values()].filter((row) => row.state === state)
    .map((row) => quoted.get(row.attemptId) ?? 0);
  const credited = ended("failed_and_credited");
  const refused = ended("quote_refused");
  const sum = (amounts) => amounts.reduce((total, amount) => total + amount, 0);

  return {
    proposed: proposed.size, merged: merged.size, closed: closed.size, open: proposed.size - merged.size - closed.size,
    mergeRate: proposed.size ? merged.size / proposed.size : null,
    closedSpend,
    useful, costPerUsefulAnswer: useful ? netSpend / useful : null,
    escrowCredits: { count: credited.length, amountUsdc: sum(credited) },
    refusedQuotes: { count: refused.length, amountUsdc: sum(refused) },
    chargedWithoutAnswer: chargedWithoutAnswer(rows),
  };
};
