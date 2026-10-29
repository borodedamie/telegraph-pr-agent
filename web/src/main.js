// Minimal M1 dashboard: render ledger.jsonl receipts from the `ledger` branch as telegrams.
const REPO = "borodedamie/telegraph-pr-agent";
const LEDGER_URL = `https://raw.githubusercontent.com/${REPO}/ledger/ledger.jsonl`;
const EXPLORER = "https://sepolia.basescan.org/tx/";

const app = document.getElementById("app");

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

const short = (hash) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;
const when = (ts) =>
  new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function tape(...parts) {
  // Telegram copy: words separated by STOP.
  return el("p", { class: "tape" }, parts.join(" STOP ") + " STOP");
}

function telegram(r, i) {
  return el(
    "article",
    { class: `telegram ${r.status}`, style: `--i:${i}` },
    el(
      "header",
      { class: "form-head" },
      el("span", {}, `PR #${r.prNumber}`),
      el("time", { datetime: r.timestamp }, when(r.timestamp))
    ),
    tape(r.intent.toUpperCase(), `PAID ${r.amountUsdc.toFixed(6)} USDC TO ${r.minerName.toUpperCase()}`),
    el("p", { class: "tape answer" }, r.answerPreview),
    el(
      "footer",
      { class: "form-foot" },
      el("span", {}, `Miner ${r.minerId}`),
      el(
        "a",
        { href: `${EXPLORER}${r.txHash}`, target: "_blank", rel: "noopener", title: r.txHash },
        `Tx ${short(r.txHash)} ↗`
      )
    ),
    el("span", { class: "stamp", "aria-label": `Status: ${r.status}` }, r.status)
  );
}

async function main() {
  app.append(
    el(
      "header",
      { class: "masthead" },
      el("h1", {}, "Telegraph"),
      el("p", { class: "sub" }, "PR agent spend ledger · Base Sepolia (eip155:84532)")
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
    app.append(
      el(
        "p",
        { class: "tally" },
        `${settled.length} settled · ${total.toFixed(6)} USDC paid · ${rows.length - settled.length} failed`
      ),
      el("section", { class: "feed", "aria-label": "Receipts, newest first" }, ...rows.map(telegram))
    );
  } catch (err) {
    app.append(
      el(
        "div",
        { class: "empty" },
        el("p", {}, "No receipts on the wire yet."),
        el("p", { class: "detail" }, `Receipts appear here once the bot settles its first PR answer. (${err.message})`)
      )
    );
  }
}

main();
