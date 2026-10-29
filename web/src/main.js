const REPO = "borodedamie/telegraph-pr-agent";
const LEDGER_URL = `https://raw.githubusercontent.com/${REPO}/ledger/ledger.jsonl`;
const EXPLORER = "https://sepolia.basescan.org/tx/";
const SIGNAL_URL = "https://devnode.telegraphprotocol.com/engine/v1/signal/";

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

async function loadRows() {
  const res = await fetch(`${LEDGER_URL}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`ledger fetch failed: HTTP ${res.status}`);
  return (await res.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

const usdc = (n) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const when = (ts) =>
  new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
            el("strong", {}, `PR #${row.prNumber}`),
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
            el("strong", {}, `PR #${row.prNumber}`),
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
    ["PR", `#${row.prNumber}`],
    ["Intent", row.intent],
    ["Miner ID", row.minerId],
    ["Miner", row.minerName],
    ["Amount", `${row.amountUsdc} USDC`],
    [
      "Tx hash",
      el("a", { href: `${EXPLORER}${row.txHash}`, target: "_blank", rel: "noopener" }, `${row.txHash} ↗`),
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

function table(rows) {
  const body = el("tbody", {});
  rows.forEach((r, i) => {
    const view = el(
      "button",
      { class: "view-btn", type: "button", "aria-label": `View receipt for PR #${r.prNumber}` },
      "View →"
    );
    view.addEventListener("click", () => openDrawer(r, view));
    body.append(
      el(
        "tr",
        { class: "row-anim", style: `--i:${i}` },
        el("td", {}, el("span", { class: "time" }, when(r.timestamp))),
        el("td", {}, el("span", { class: "pr" }, `#${r.prNumber}`)),
        el("td", {}, el("span", { class: "intent" }, task(r.intent))),
        el("td", {}, el("span", { class: "miner", title: r.minerName }, r.minerName)),
        el("td", { class: "num" }, el("span", { class: "amount" }, usdc(r.amountUsdc), el("small", {}, "USDC"))),
        el("td", {}, el("span", { class: `status ${r.status}` }, r.status === "settled" ? "Settled" : "Failed")),
        el("td", { class: "num" }, view)
      )
    );
  });
  return el(
    "div",
    { class: "ledger-wrap" },
    el(
      "table",
      { class: "ledger", "aria-label": "Purchases, newest first" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          ...["Time", "PR", "Intent", "Miner", "Amount", "Status", ""].map((h, idx) =>
            el("th", { class: idx === 4 || idx === 6 ? "num" : "" }, h)
          )
        )
      ),
      body
    )
  );
}

async function main() {
  app.append(
    el(
      "header",
      { class: "masthead" },
      el(
        "div",
        {},
        el("h1", {}, "Telegraph"),
        el(
          "p",
          { class: "sub" },
          "PR agent spend ledger · Base Sepolia ",
          el("code", {}, "eip155:84532")
        )
      ),
      el(
        "div",
        { class: "spend-total" },
        el("span", { class: "label" }, "Spend to date"),
        el("span", { class: "figure" }, "0.000000 ", el("small", {}, "USDC"))
      )
    ),
    el(
      "p",
      { class: "boundary" },
      el("strong", {}, "Testnet build. "),
      "Routing, miners, verification and settlement are real; USDC is testnet-denominated. No revenue claim is made."
    )
  );
  try {
    const rows = (await loadRows()).reverse(); // newest first
    const settled = rows.filter((r) => r.status === "settled");
    const total = settled.reduce((sum, r) => sum + r.amountUsdc, 0);
    app.querySelector(".spend-total .figure").replaceChildren(
      usdc(total),
      el("small", {}, " USDC")
    );
    app.append(
      el(
        "p",
        { class: "tally" },
        `${settled.length} settled`,
        el("span", { class: "dot" }, "·"),
        `${usdc(total)} USDC paid`,
        el("span", { class: "dot" }, "·"),
        `${rows.length - settled.length} failed`
      ),
      table(rows)
    );
  } catch (err) {
    app.append(
      el(
        "div",
        { class: "empty" },
        el("p", {}, "No receipts on the wire yet."),
        el(
          "p",
          { class: "detail" },
          `Receipts appear here once the bot settles its first PR answer. (${err.message})`
        )
      )
    );
  }
}

main();
