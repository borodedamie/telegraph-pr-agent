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
  return { total, count: prs.size, average: prs.size ? total / prs.size : null };
};
