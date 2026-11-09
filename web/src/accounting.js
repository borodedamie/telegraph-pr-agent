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
  const netSpend = [...settled.values()].reduce((sum, row) => sum + row.amountUsdc, 0);
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
