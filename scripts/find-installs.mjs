// Find repositories that use the Action, to keep the README evidence index and the dashboard's
// KNOWN_INSTALLS complete; above all, to notice an outside installation. Run weekly by
// .github/workflows/find-installs.yml until 1 Dec 2026, or by hand: node scripts/find-installs.mjs
// Prints a Markdown report. Needs the GitHub CLI (`gh`) signed in, or GH_TOKEN set.
// Both sources lag: code search and the dependents page can miss a repository that does use the
// Action (on 19 Nov both missed lemind/onewallet-radar), so a missing repo is not proof of absence.
import { execFileSync } from "node:child_process";
import { KNOWN_INSTALLS, ownerLabel } from "../web/src/accounting.js";

const ACTION = "borodedamie/telegraph-pr-agent";
const found = new Map(); // lowercased repo -> { repo, sources }
const problems = [];
const add = (repo, source) => {
  const key = repo.toLowerCase();
  if (key === ACTION) return; // the Action's own repository runs it locally (uses: ./)
  const entry = found.get(key) ?? { repo, sources: new Set() };
  entry.sources.add(source);
  found.set(key, entry);
};

// 1. Code search for workflow files that reference the Action. A failure is reported, not hidden.
try {
  const hits = JSON.parse(execFileSync("gh", ["search", "code", `${ACTION}@`, "--json", "repository", "--limit", "100"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  for (const hit of hits) add(hit.repository.nameWithOwner, "code search");
} catch (err) {
  problems.push(`Code search failed: ${String(err.stderr || err.message).trim().split("\n")[0]}`);
}

// 2. The dependents page (GitHub's dependency graph). First page only: up to 30 repositories.
try {
  const res = await fetch(`https://github.com/${ACTION}/network/dependents`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  for (const [, repo] of (await res.text()).matchAll(/data-hovercard-type="repository"[^>]*href="\/([^"/]+\/[^"/]+)"/g)) {
    add(repo, "dependents page");
  }
} catch (err) {
  problems.push(`Dependents page failed: ${err.message}`);
}

// 3. Known installs that neither source found stay listed, marked as missed by the index.
for (const repo of KNOWN_INSTALLS) {
  if (repo.toLowerCase() !== ACTION && !found.has(repo.toLowerCase())) add(repo, "known only (missed by search)");
}

const known = new Set(KNOWN_INSTALLS.map((r) => r.toLowerCase()));
const rows = [];
for (const { repo, sources } of [...found.values()].sort((a, b) => a.repo.localeCompare(b.repo))) {
  const ledger = await fetch(`https://raw.githubusercontent.com/${repo}/ledger/ledger.jsonl`, { method: "HEAD" }).catch(() => null);
  rows.push({ repo, owner: ownerLabel(repo), ledger: ledger?.ok ? "yes" : "no", sources: [...sources].join(", "),
    status: known.has(repo.toLowerCase()) ? "known" : "**NEW**: add to `KNOWN_INSTALLS` and the README evidence index" });
}
const outside = rows.filter((r) => r.owner === "outside");
const fresh = rows.filter((r) => r.status !== "known");

console.log(`### Installs of \`${ACTION}\`, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n`);
console.log(`${rows.length} found · ${outside.length} outside · ${fresh.length} new\n`);
console.log("| Repository | Owner | Ledger (bot has run) | Found by | Status |\n| --- | --- | --- | --- | --- |");
for (const r of rows) console.log(`| [\`${r.repo}\`](https://github.com/${r.repo}) | ${r.owner} | ${r.ledger} | ${r.sources} | ${r.status} |`);
if (problems.length) console.log(`\n**Not checked fully:** ${problems.join("; ")}`);
