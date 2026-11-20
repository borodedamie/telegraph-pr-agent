// Rows store the explorer of the chain they paid on. Rows written before 5 Nov 2026
// don't, so their date decides: the devnode moved Base → Ethereum Sepolia on 1 Nov.
export const explorerBase = (row) =>
  row.explorerBaseUrl ?? (row.timestamp < "2026-11-01" ? "https://sepolia.basescan.org" : "https://sepolia.etherscan.io");
// GitHub accounts of the team (agreed 19 Nov 2026). A repository they own is "team" (related-party
// evidence); any other owner is "outside".
export const TEAM_OWNERS = ["borodedamie", "lemind", "codexempire"];
// Known installations, shown when no ?repo= is given. See README "Evidence index".
export const KNOWN_INSTALLS = ["borodedamie/telegraph-pr-agent", "borodedamie/grpc-tutorial", "lemind/onewallet-radar"];

export const ownerLabel = (repo) => (TEAM_OWNERS.includes(repo.split("/")[0].toLowerCase()) ? "team" : "outside");

/** Mark each row with the ledger it came from; early rows that predate the `repo` field get it here. */
export const tagRows = (repo, rows) =>
  rows.map((row) => ({ ...row, repo: row.repo ?? repo, ledgerRepo: repo, owner: ownerLabel(repo) }));

export const SIGNAL_URL = "https://devnode.telegraphprotocol.com/engine/v1/signal/";

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

// A merge row carrying `baseRef` was written by #40's branch-checked accounting, so it landed on
// the default (or a counted release) branch. A merge row without `baseRef` predates that check and
// may have merged into a test or feature branch, so it must never count as a merged PR.
const countedMerge = (row) => row.kind === "merge" && typeof row.baseRef === "string";

/** Keep receipt-linked allocation separate from all recorded net spending per merged PR. */
export const mergedCosts = (rows) => {
  const purchases = new Map(rows.filter((row) => !row.kind && row.status === "settled" && row.receiptHash)
    .map((row) => [row.receiptHash, row]));
  const prs = new Set();
  const receipts = new Set();
  let total = 0;
  for (const row of rows.filter(countedMerge)) {
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

/** Seconds from the paid request to the first delivered answer, per attempt. */
export const answerLatency = (rows) => {
  const requested = new Map(rows.filter((row) => row.kind === "attempt" && row.state === "request_sent" && row.attemptId)
    .map((row) => [row.attemptId, Date.parse(row.timestamp)]));
  const byAttempt = new Map();
  for (const row of rows.filter((row) => row.kind === "attempt" && row.state === "delivered" && row.attemptId)) {
    const start = requested.get(row.attemptId);
    const end = Date.parse(row.timestamp);
    // Later delivered rows only update answer quality; the first one is the delivery.
    if (!Number.isFinite(start) || !Number.isFinite(end) || byAttempt.has(row.attemptId)) continue;
    byAttempt.set(row.attemptId, (end - start) / 1000);
  }
  const values = [...byAttempt.values()].sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const medianSeconds = values.length === 0 ? null
    : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return { medianSeconds, count: values.length, byAttempt };
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
const prOutcomes = (rows) => {
  const pr = (row) => `${row.repo}#${row.prNumber}`;
  const merges = rows.filter((row) => row.kind === "merge");
  const merged = new Set(merges.filter(countedMerge).map(pr));
  // A merge without baseRef (pre-#40) is merged outside the default branch, so it counts as closed.
  const closed = new Set([
    ...rows.filter((row) => row.kind === "closed").map(pr),
    ...merges.filter((row) => !countedMerge(row)).map(pr),
  ].filter((key) => !merged.has(key)));
  const proposed = new Set([...rows.filter((row) => row.kind === "proposal").map(pr), ...merged, ...closed]);
  return { pr, merged, closed, proposed };
};

export const outcomeSummary = (rows) => {
  // Free PRs (pre-cutoff upgrades, nothing bought) are counted apart: they never enter paid rates or spend.
  const free = prOutcomes(rows.filter((row) => row.free === true));
  const { pr, merged, closed, proposed } = prOutcomes(rows.filter((row) => row.free !== true));

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
    free: { proposed: free.proposed.size, merged: free.merged.size, closed: free.closed.size,
      open: free.proposed.size - free.merged.size - free.closed.size },
    useful, costPerUsefulAnswer: useful ? netSpend / useful : null,
    escrowCredits: { count: credited.length, amountUsdc: sum(credited) },
    refusedQuotes: { count: refused.length, amountUsdc: sum(refused) },
    chargedWithoutAnswer: chargedWithoutAnswer(rows),
  };
};

const EVIDENCE_COLUMNS = ["record", "date", "repo", "owner", "package", "current_version", "target_version", "intent",
  "miner_id", "miner_name", "selected_by", "miner_rank", "amount_usdc", "network", "receipt_hash", "signal_url",
  "tx_url", "answer_quality", "pr_number", "pr_outcome", "evidence_incomplete", "note"];

// Columns whose text comes from outside the team. Only these get the formula guard:
// package names come from the repo's own manifest, and scoped npm names start with "@".
const EXTERNAL_TEXT = new Set(["miner_name", "note"]);

// RFC 4180 quoting, and for external text a leading ' on anything a spreadsheet would run as a formula.
const csvCell = (value, external) => {
  let text = value === undefined || value === null ? "" : String(value);
  if (external && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * One line per settled purchase and per attempt reconciled as charged with no answer,
 * with receipt, signal and transaction links, answer quality and PR outcome (SPEC §5).
 * Pass rows already narrowed to the reporting window.
 */
export const evidenceCsv = (rows) => {
  const outcomes = new Map();
  for (const row of rows.filter((row) => row.kind === "proposal" && row.receiptHash)) outcomes.set(row.receiptHash, { pr: row.prNumber, outcome: "open" });
  for (const row of rows.filter((row) => row.kind === "closed" && row.receiptHash)) outcomes.set(row.receiptHash, { pr: row.prNumber, outcome: "closed_unmerged" });
  // Applied last: a counted merge outranks an earlier close.
  for (const row of rows.filter((row) => countedMerge(row) && row.receiptHash)) outcomes.set(row.receiptHash, { pr: row.prNumber, outcome: "merged" });
  const tx = (row) => (row.txHash && explorerBase(row) ? `${explorerBase(row)}/tx/${row.txHash}` : "");
  const lines = purchaseRows(rows).filter((row) => row.status === "settled").map((row) => {
    const pr = outcomes.get(row.receiptHash);
    return ["purchase", row.timestamp, row.repo, row.owner, row.package, row.currentVersion, row.targetVersion, row.intent,
      row.minerId, row.minerName, row.selectedBy, row.minerRank, row.amountUsdc, row.network, row.receiptHash,
      row.signalHash ? `${SIGNAL_URL}${row.signalHash}` : "", tx(row), row.resultStatus, pr?.pr, pr?.outcome,
      row.evidenceIncomplete ? "yes" : "", ""];
  });
  const latest = new Map();
  for (const row of rows.filter((row) => row.kind === "attempt" && row.attemptId)) latest.set(row.attemptId, row);
  for (const row of [...latest.values()].filter((row) => row.state === "failed_and_charged")) {
    lines.push(["charged_no_answer", row.timestamp, row.repo, row.owner, "", "", "", "", row.minerId, "", "", "",
      row.chargedAmountUsdc, "", "", "", tx(row), "", "", "", "", `reconciled by ${row.reconciledBy}: ${row.reason ?? ""}`]);
  }
  lines.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return [EVIDENCE_COLUMNS, ...lines]
    .map((line) => line.map((value, i) => csvCell(value, EXTERNAL_TEXT.has(EVIDENCE_COLUMNS[i]))).join(","))
    .join("\r\n") + "\r\n";
};

/**
 * Per-repository figures and totals split into team and outside. `ledgers` holds
 * { repo, rows } for a ledger that loaded and { repo, error } for one that did not. A failed
 * ledger stays in the list with its error and is counted in its group's `failed`, so a total
 * is never silently short.
 */
export const repoSummary = (ledgers) => {
  const perRepo = ledgers.map(({ repo, rows, error }) => {
    const owner = ownerLabel(repo);
    if (error !== undefined) return { repo, owner, error };
    const tagged = tagRows(repo, rows);
    const costs = mergedCosts(tagged);
    const outcomes = outcomeSummary(tagged);
    return { repo, owner, purchases: purchaseRows(tagged).filter((row) => row.status === "settled").length,
      spendUsdc: costs.netSpend, merged: outcomes.merged, closed: outcomes.closed, open: outcomes.open };
  });
  const totals = {};
  for (const owner of ["team", "outside"]) {
    const group = perRepo.filter((r) => r.owner === owner);
    const loaded = group.filter((r) => r.error === undefined);
    const add = (key) => loaded.reduce((sum, r) => sum + r[key], 0);
    const merged = add("merged");
    totals[owner] = { repos: group.length, failed: group.length - loaded.length, purchases: add("purchases"),
      spendUsdc: add("spendUsdc"), merged, costPerMergedPr: merged ? add("spendUsdc") / merged : null };
  }
  return { perRepo, totals };
};
