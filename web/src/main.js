import { answerLatency, EVENT_WINDOW, evidenceCsv, explorerBase, inWindow, KNOWN_INSTALLS, mergedCosts, outcomeSummary,
  purchaseRows, repoSummary, SIGNAL_URL, tagRows } from "./accounting.js";
// ?repo=owner/name views one public repository running the Action; ?repo=a/b,c/d views several together.
// With no ?repo=, every known installation is shown.
const REPO_PARAM = new URLSearchParams(location.search).get("repo");
const REPOS = REPO_PARAM ? REPO_PARAM.split(",").map((repo) => repo.trim()).filter(Boolean) : KNOWN_INSTALLS;
const ledgerUrl = (repo) => `https://raw.githubusercontent.com/${repo}/ledger/ledger.jsonl`;

const app = document.getElementById("app");
const drawer = document.getElementById("drawer");
const backdrop = document.getElementById("backdrop");

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/** One repository's ledger: { repo, rows } when it loads, { repo, error } when it doesn't. Never throws. */
async function loadLedger(repo) {
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`must be owner/name, got "${repo}"`);
    const res = await fetch(`${ledgerUrl(repo)}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`ledger fetch failed: HTTP ${res.status}`);
    const rows = (await res.text()).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    return { repo, rows };
  } catch (err) {
    return { repo, error: err instanceof Error ? err.message : String(err) };
  }
}

// Team and outside are never mixed in one total, and a ledger that failed to load is listed, not dropped.
// Figures cover the event window, like the README evidence index.
function repositories({ perRepo, totals }) {
  const ownerCard = (owner) => {
    const t = totals[owner];
    const title = owner === "team" ? "Team (related-party)" : "Outside";
    if (t.repos === 0) return stat(title, "0", "no repositories yet");
    return stat(title, `${usdc(t.spendUsdc)} USDC`,
      `${t.repos} ${t.repos === 1 ? "repo" : "repos"} · ${t.purchases} purchases · ${t.merged} merged PRs · cost per merged PR `
        + (t.costPerMergedPr === null ? "N/A" : `${usdc(t.costPerMergedPr)} USDC (n=${t.merged})`)
        + (t.failed ? ` · INCOMPLETE: ${t.failed} of ${t.repos} ledgers failed to load` : ""),
      t.failed ? "warn" : "");
  };
  const body = el("tbody", {}, ...perRepo.map((r) => el("tr", {},
    el("td", {}, el("a", { href: `?repo=${r.repo}` }, r.repo), " ", el("span", { class: `tag ${r.owner}` }, r.owner)),
    ...(r.error !== undefined
      ? [el("td", { colspan: "3", class: "error" }, el("strong", {}, "Ledger failed to load: "), r.error)]
      : [el("td", { class: "num" }, String(r.purchases)),
        el("td", { class: "num" }, el("span", { class: "amount" }, usdc(r.spendUsdc), el("small", {}, "USDC"))),
        el("td", { class: "num" }, `${r.merged} / ${r.closed} / ${r.open}`)]),
    el("td", { class: "num" }, el("a", { href: ledgerUrl(r.repo), target: "_blank", rel: "noopener" }, "ledger ↗")))));
  return [
    // The team/outside split only means something when several repositories are on screen.
    ...(REPOS.length > 1
      ? [el("h2", { class: "section" }, `Event window · ${EVENT_WINDOW.label}`),
        el("div", { class: "stats two" }, ownerCard("team"), ownerCard("outside"))]
      : []),
    el("h2", { class: "section" }, "Repositories"),
    el("div", { class: "ledger-wrap" }, el("table", { class: "ledger repos", "aria-label": "Repositories running the bot" },
      el("thead", {}, el("tr", {}, el("th", {}, "Repository"), el("th", { class: "num" }, "Purchases"),
        el("th", { class: "num" }, "Spend"),
        el("th", { class: "num" }, el("span", { class: "long" }, "PRs merged / closed / open"),
          el("span", { class: "short", title: "PRs merged / closed / open" }, "PRs m/c/o")),
        el("th", {}, ""))),
      body)),
  ];
}

/** One headline figure: label, value, and the counts behind it. */
function stat(label, value, note, tone = "") {
  return el("div", { class: `stat ${tone}` },
    el("span", { class: "k" }, label), el("span", { class: "v" }, value), el("span", { class: "s" }, note));
}

const usdc = (n) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const when = (ts) =>
  new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
// With several repositories on screen, PR numbers repeat, so the label names the repository too.
const purchaseLabel = (row) => {
  const label = row.prNumber ? `PR #${row.prNumber}` : `${row.package ?? "Dependency"} assessment`;
  return REPOS.length > 1 ? `${row.repo} · ${label}` : label;
};
const task = (intent) =>
  intent
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

let lastTrigger = null;

function openDrawer(row, trigger) {
  lastTrigger = trigger;
  const ok = row.status === "settled";
  drawer.replaceChildren();
  drawer.append(
    el(
      "div",
      { class: "drawer-inner" },
      el(
        "div",
        { class: "drawer-head" },
        el("h2", {}, "Receipt"),
        el("span", { class: `status ${row.status}` }, ok ? "Settled" : "Failed"),
        el("button", { class: "close-btn", type: "button", "aria-label": "Close details" }, "✕ close")
      ),
      ok
        ? el(
            "p",
            { class: "line" },
            "Paid ",
            el("strong", {}, `${usdc(row.amountUsdc)} USDC`),
            " to ",
            el("strong", {}, row.minerName),
            ` for ${task(row.intent)} on `,
            el("strong", {}, purchaseLabel(row)),
            "."
          )
        : el(
            "p",
            { class: "line" },
            "Payment of ",
            el("strong", {}, `${usdc(row.amountUsdc)} USDC`),
            " to ",
            el("strong", {}, row.minerName),
            ` for ${task(row.intent)} on `,
            el("strong", {}, purchaseLabel(row)),
            " didn’t go through."
          ),
      // ponytail: answerPreview fallback is for pre-Engine rows; drop once the ledger is re-run in the event window.
      el("blockquote", { class: "answer" }, row.answer ?? row.answerPreview ?? ""),
      fields(row)
    )
  );
  drawer.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    drawer.classList.add("open");
    backdrop.classList.add("open");
    drawer.querySelector(".close-btn").focus();
  });
}

// Every recorded field lives here — the table stays a table.
function fields(row) {
  const pairs = [
    ["PR", purchaseLabel(row)],
    ["Repository", row.repo],
    ["Package", row.package],
    ["Target version", row.targetVersion],
    ["Selected by", row.selectedBy],
    ["Coding model", row.model?.model && `${row.model.provider} / ${row.model.model}`],
    ["Model cutoff", row.model && `${row.model.cutoff} (${row.model.status})`],
    ["Cutoff source", row.model?.sourceUrl],
    ["Configured at", row.model?.configuredAt],
    ["Evidence", row.evidenceIncomplete && "Incomplete; reconcile missing payment hashes"],
    ["Intent", row.intent],
    ["Miner ID", row.minerId],
    ["Miner", row.minerName],
    ["Amount", `${row.amountUsdc} USDC`],
    ["Answer quality", row.resultStatus],
    ["No answer because", row.resultStatus !== "useful" && row.resultReason],
    ["Answer latency", row.latencySeconds !== undefined && `${row.latencySeconds.toFixed(1)} s from recording the paid request`],
    ["Network", row.network],
    ["USDC contract", row.usdcContract],
    [
      "Tx hash",
      explorerBase(row)
        ? el("a", { href: `${explorerBase(row)}/tx/${row.txHash}`, target: "_blank", rel: "noopener" }, `${row.txHash} ↗`)
        : row.txHash,
    ],
    ["Receipt hash", row.receiptHash],
    [
      "Signal hash",
      row.signalHash &&
        el("a", { href: `${SIGNAL_URL}${row.signalHash}`, target: "_blank", rel: "noopener" }, `${row.signalHash} ↗`),
    ],
    ["Leaderboard", row.minerRank && `#${row.minerRank} for ${row.intent} · score ${row.minerScore}`],
    ["Head SHA", row.headSha],
    ["Timestamp", el("time", { datetime: row.timestamp }, `${when(row.timestamp)} · ${row.timestamp}`)],
    ["Status", row.status],
  ];
  return el(
    "dl",
    { class: "fields" },
    ...pairs.filter(([, v]) => v).map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v)))
  );
}

function closeDrawer() {
  drawer.classList.remove("open");
  backdrop.classList.remove("open");
  const done = () => {
    drawer.hidden = true;
    backdrop.hidden = true;
    if (lastTrigger) lastTrigger.focus();
  };
  drawer.addEventListener("transitionend", done, { once: true });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) done();
}

backdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
});
drawer.addEventListener("click", (e) => {
  if (e.target.closest(".close-btn")) closeDrawer();
});

const PAGE_SIZE = 25;

function purchaseRow(r, i) {
  const view = el(
    "button",
    { class: "view-btn", type: "button", "aria-label": `View receipt for ${purchaseLabel(r)}` },
    "View →"
  );
  view.addEventListener("click", () => openDrawer(r, view));
  const label = r.prNumber ? `PR #${r.prNumber}` : (r.package ?? "Dependency");
  return el(
    "tr",
    { class: "row-anim", style: `--i:${i}` },
    el("td", { class: "c-what" },
      el("span", { class: "pr" }, label),
      el("span", { class: "repo" }, REPOS.length > 1 ? r.repo : (r.prNumber ? "" : "assessment"))),
    el("td", { class: "c-miner" },
      el("span", { class: "miner", title: r.minerName }, r.minerName),
      el("span", { class: "intent" }, task(r.intent))),
    el("td", { class: "c-time" }, el("time", { class: "time", datetime: r.timestamp }, when(r.timestamp))),
    el("td", { class: "num c-amount" }, el("span", { class: "amount" }, usdc(r.amountUsdc), el("small", {}, "USDC"))),
    el("td", { class: "c-status" }, el("span", { class: `status ${r.status}` }, r.status === "settled" ? "Settled" : "Failed")),
    el("td", { class: "num c-view" }, view)
  );
}

// Newest PAGE_SIZE rows first; "Show more" adds the next batch. Totals and CSV still cover every row.
function table(rows) {
  const body = el("tbody", {});
  let shown = 0;
  const more = el("button", { type: "button", class: "export-btn more-btn" });
  const showMore = () => {
    const batch = rows.slice(shown, shown + PAGE_SIZE);
    body.append(...batch.map((r, i) => purchaseRow(r, i)));
    shown += batch.length;
    more.hidden = shown >= rows.length;
    more.textContent = `Show more (${rows.length - shown} left)`;
  };
  more.addEventListener("click", showMore);
  showMore();
  return el(
    "div",
    { class: "ledger-wrap" },
    el(
      "table",
      { class: "ledger purchases", "aria-label": "Purchases, newest first" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          ...["Purchase", "Miner", "Time", "Amount", "Status", ""].map((h, idx) =>
            el("th", { class: idx === 3 || idx === 5 ? "num" : "" }, h)
          )
        )
      ),
      body
    ),
    more
  );
}

// Built in the browser from the public ledger; nothing is uploaded.
function evidenceButton(entries) {
  const button = el("button", { type: "button", class: "export-btn" }, `Download evidence CSV (${EVENT_WINDOW.label})`);
  button.addEventListener("click", () => {
    const csv = evidenceCsv(inWindow(entries, EVENT_WINDOW));
    const link = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
      download: `telegraph-evidence-${REPOS.length === 1 ? REPOS[0].replace("/", "-") : `${REPOS.length}-repos`}-2026-11-01_2026-12-01.csv` });
    link.click();
    URL.revokeObjectURL(link.href);
  });
  return button;
}

// Plain-English latency: a median of one or two purchases would be misleading,
// so name the actual values instead of a statistic.
// The times run from recording request_sent, which is pushed to the ledger before the
// payment goes out, so they include a few seconds of ledger writing, not only the answer.
function latencyLine({ count, medianSeconds, byAttempt }) {
  if (count === 0) return "answer speed not measured yet";
  if (count <= 2) {
    const times = [...byAttempt.values()].sort((a, b) => a - b);
    return `answer recorded ${times.map((t) => `~${t.toFixed(0)} s`).join(" and ")} after recording the paid request (${count === 1 ? "1 purchase" : "2 purchases"})`;
  }
  return `answer usually recorded ~${medianSeconds.toFixed(0)} s after recording the paid request (${count} purchases)`;
}

// SPEC §4.3: counts and sample size beside every rate, never a bare percentage.
function outcomesLine(o) {
  const rate = o.mergeRate === null ? "merge rate N/A" : `merge rate ${Math.round(o.mergeRate * 100)}% (${o.merged} of ${o.proposed} PRs)`;
  const useful = o.costPerUsefulAnswer === null ? "cost per useful answer N/A"
    : `${usdc(o.costPerUsefulAnswer)} USDC per useful answer (${o.useful} useful)`;
  return `${o.proposed} PRs proposed · ${o.merged} merged · ${o.closed} closed unmerged (${usdc(o.closedSpend)} USDC) · ${o.open} open · ${rate} · ${useful}`
    + (o.free.proposed ? ` · free pre-cutoff PRs (no purchase): ${o.free.proposed} proposed, ${o.free.merged} merged, ${o.free.closed} closed, ${o.free.open} open` : "")
    + ` · escrow credits ${usdc(o.escrowCredits.amountUsdc)} USDC (${o.escrowCredits.count}, not spend)`
    + ` · refused quotes ${usdc(o.refusedQuotes.amountUsdc)} USDC (${o.refusedQuotes.count}, not spend)`
    + (o.chargedWithoutAnswer.count
      ? ` · charged with no answer ${usdc(o.chargedWithoutAnswer.amountUsdc)} USDC (${o.chargedWithoutAnswer.count}, included in spend)` : "");
}

async function main() {
  app.append(
    el(
      "header",
      { class: "masthead" },
      el(
        "div",
        {},
        el("p", { class: "eyebrow" }, "Telegraph PR Agent"),
        el("h1", {}, "Spend ledger"),
        el(
          "p",
          { class: "sub" },
          `What the bot paid Telegraph miners for each dependency upgrade · ${REPOS.length === 1 ? REPOS[0] : `${REPOS.length} repositories`} · Ethereum Sepolia `,
          el("code", {}, "eip155:11155111")
        )
      ),
      el("span", { class: "badge" }, "Testnet")
    ),
    el(
      "p",
      { class: "boundary" },
      "Routing, miners, verification and settlement are real; USDC is testnet-denominated. No revenue claim is made."
    )
  );
  try {
    const ledgers = await Promise.all(REPOS.map(loadLedger));
    // The split matches the README evidence index: event window only.
    const summary = repoSummary(ledgers.map((l) => (l.error === undefined ? { ...l, rows: inWindow(l.rows, EVENT_WINDOW) } : l)));
    const entries = ledgers.filter((l) => l.error === undefined).flatMap((l) => tagRows(l.repo, l.rows));
    const costs = mergedCosts(entries);
    const outcomes = outcomeSummary(entries);
    const eventCosts = mergedCosts(inWindow(entries, EVENT_WINDOW));
    const latency = answerLatency(entries);
    const reasons = new Map(entries.filter((row) => row.kind === "attempt" && row.attemptId && row.reason)
      .map((row) => [row.attemptId, row.reason]));
    const rows = purchaseRows(entries).reverse() // newest purchases first
      .map((row) => ({ ...row, latencySeconds: latency.byAttempt.get(row.attemptId), resultReason: reasons.get(row.attemptId) }));
    const settled = rows.filter((r) => r.status === "settled");
    const notFound = settled.filter((r) => r.resultStatus === "not_found").length;
    const total = settled.reduce((sum, r) => sum + r.amountUsdc, 0);
    const failed = rows.length - settled.length;
    const freePrs = outcomes.free.proposed ? ` · +${outcomes.free.proposed} free (no purchase)` : "";
    app.append(
      el("div", { class: "stats" },
        stat("Spent", `${usdc(total)} USDC`, `${settled.length} paid answers${failed ? ` · ${failed} failed` : ""}`),
        stat("Cost per merged PR", costs.count ? `${usdc(costs.costPerMergedPr)} USDC` : "N/A",
          costs.count ? `${costs.count} merged PRs` : "no bot PR merged yet"),
        stat("Bot PRs", String(outcomes.proposed),
          `${outcomes.merged} merged · ${outcomes.closed} closed · ${outcomes.open} open${freePrs}`),
        stat("Useful answers", `${outcomes.useful} of ${settled.length}`,
          notFound ? `${notFound} bought a dead end (not_found)` : "no dead ends"),
        stat("Answer speed", latency.count ? `~${(latency.count <= 2
          ? Math.max(...latency.byAttempt.values()) : latency.medianSeconds).toFixed(0)} s` : "—",
          latency.count ? `${latency.count <= 2 ? "slowest" : "median"} of ${latency.count} purchases` : "not measured yet")),
      // Every count stays on the page (SPEC §4.3), one click away from the headline.
      el("details", { class: "notes" },
        el("summary", {}, "All counts and how they are measured"),
        el("p", {}, `${settled.length} settled · ${usdc(total)} USDC paid · ${failed} failed · `
          + `${notFound ? `${notFound} bought a dead end (not_found)` : "0 dead ends"} · ${latencyLine(latency)}`),
        el("p", {}, costs.count
          ? `${usdc(costs.costPerMergedPr)} USDC recorded net spend per merged PR · ${costs.count} merged PRs · ${usdc(costs.netSpend)} USDC total · ${usdc(costs.total)} USDC allocated to merges · ${usdc(costs.unmergedSpend)} USDC unmerged/unallocated`
          : `Cost per merged PR: N/A · ${usdc(costs.netSpend)} USDC recorded spend · no merged PRs`),
        el("p", {}, outcomesLine(outcomes)),
        el("p", {}, `Event window ${EVENT_WINDOW.label}: `, eventCosts.count
          ? `${usdc(eventCosts.costPerMergedPr)} USDC per merged PR · ${eventCosts.count} merged · ${usdc(eventCosts.netSpend)} USDC spent`
          : `cost per merged PR N/A · ${usdc(eventCosts.netSpend)} USDC spent · no merged PRs`)),
      ...repositories(summary),
      el("div", { class: "section-row" },
        el("h2", { class: "section" }, "Purchases"),
        evidenceButton(entries)),
      table(rows)
    );
  } catch (err) {
    app.append(
      el(
        "div",
        { class: "empty" },
        el("p", {}, "Couldn't load the ledger."),
        el("p", { class: "detail" }, `${err.message}. The receipts are in ledger.jsonl on the ledger branch.`)
      )
    );
  }
}

main();
