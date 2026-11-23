import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { KNOWN_INSTALLS, ownerLabel } from "../web/src/accounting.js";

const ACTION = "borodedamie/telegraph-pr-agent";
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const previousPath = arg("--previous");
const outPath = arg("--out");

const found = new Map(); // lowercased repo -> { repo, sources }
const problems = [];
const add = (repo, source) => {
  const key = repo.toLowerCase();
  if (key === ACTION) return; // the Action's own repository runs it locally (uses: ./)
  const entry = found.get(key) ?? { repo, sources: new Set() };
  entry.sources.add(source);
  found.set(key, entry);
};
const ghSearch = (kind, query, source) => {
  try {
    const hits = JSON.parse(execFileSync("gh", ["search", kind, query, "--json", "repository", "--limit", "1000"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    for (const hit of hits) add(hit.repository.nameWithOwner, source);
  } catch (err) {
    problems.push(`${source} failed: ${String(err.stderr || err.message).trim().split("\n")[0]}`);
  }
};

// 1. PRs the bot opened: its branches are always fix/telegraph-dependency-<identity>.
ghSearch("prs", "head:fix/telegraph-dependency-", "PR search");
// 2. Workflow files that reference the Action.
ghSearch("code", `${ACTION}@`, "code search");
// 3. The dependents page (GitHub's dependency graph). First page only: up to 30 repositories.
try {
  const res = await fetch(`https://github.com/${ACTION}/network/dependents`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  for (const [, repo] of (await res.text()).matchAll(/data-hovercard-type="repository"[^>]*href="\/([^"/]+\/[^"/]+)"/g)) {
    add(repo, "dependents page");
  }
} catch (err) {
  problems.push(`Dependents page failed: ${err.message}`);
}
// 4. Repositories listed earlier stay listed, so a lagging index never drops one.
const previous = previousPath && existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, "utf8")).installs ?? [] : [];
for (const entry of previous) if (!found.has(entry.repo.toLowerCase())) add(entry.repo, "listed earlier");
for (const repo of KNOWN_INSTALLS) {
  if (repo.toLowerCase() !== ACTION && !found.has(repo.toLowerCase())) add(repo, "known list");
}

const firstSeen = new Map(previous.map((entry) => [entry.repo.toLowerCase(), entry.firstSeen]));
const now = new Date().toISOString();
const rows = [];
for (const { repo, sources } of [...found.values()].sort((a, b) => a.repo.localeCompare(b.repo))) {
  const ledger = await fetch(`https://raw.githubusercontent.com/${repo}/ledger/ledger.jsonl`, { method: "HEAD" }).catch(() => null);
  const isNew = !firstSeen.has(repo.toLowerCase()) && !KNOWN_INSTALLS.some((known) => known.toLowerCase() === repo.toLowerCase());
  rows.push({ repo, owner: ownerLabel(repo), ledger: Boolean(ledger?.ok), foundBy: [...sources].sort(),
    firstSeen: firstSeen.get(repo.toLowerCase()) ?? now, isNew });
}

if (outPath) {
  const installs = rows.map(({ repo, owner, firstSeen: seen }) => ({ repo, owner, firstSeen: seen }));
  writeFileSync(outPath, `${JSON.stringify({ action: ACTION, installs }, null, 2)}\n`);
}

const outside = rows.filter((r) => r.owner === "outside");
const fresh = rows.filter((r) => r.isNew);
console.log(`### Installs of \`${ACTION}\`, ${now.slice(0, 16).replace("T", " ")} UTC\n`);
console.log(`${rows.length} found · ${outside.length} outside · ${fresh.length} new\n`);
console.log("| Repository | Owner | Ledger (bot has run) | Found by | Status |\n| --- | --- | --- | --- | --- |");
for (const r of rows) {
  console.log(`| [\`${r.repo}\`](https://github.com/${r.repo}) | ${r.owner} | ${r.ledger ? "yes" : "no"} | ${r.foundBy.join(", ")} | ${KNOWN_INSTALLS.some((known) => known.toLowerCase() === r.repo.toLowerCase()) ? "verified" : r.isNew ? "**NEW**, not verified" : "not verified"} |`);
}
if (problems.length) console.log(`\n**Not checked fully:** ${problems.join("; ")}`);
