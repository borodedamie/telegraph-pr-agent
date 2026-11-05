// Benchmark harness (T057): asks a miner every case in bench/transitions.json and writes bench/report.md.
//
//   MINER_API_KEY=... pnpm bench <miner url> [--only p01,n03] [--no-repeat] [--out <dir>]
//
// Each case is asked twice: the first call measures a first-time answer (or a cache hit, if the case was
// asked before on this processing version; the x-miner-cache header says which), the second a repeat.
// Answers are saved to --out (default: the OS temp dir). GITHUB_TOKEN, if set, lifts GitHub's rate limit
// for the source checks. Release text is fetched here independently of the miner.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import semver from "semver";
import { releasesBetween } from "../src/coverage.js";
import { Answer, type ChangeItem } from "../src/types.js";

interface ExpectedEntry {
  version: string;
  change: string;
  quote: string;
}

interface BenchCase {
  id: string;
  query: string | null;
  package?: string;
  from?: string;
  to?: string;
  tags?: string[];
  localOnly?: boolean;
  expected: {
    outcome: string | string[];
    breaking?: ExpectedEntry[];
    notCoveredMustInclude?: string[];
    mustNotSuggestSafeUpgrade?: boolean;
  };
}

interface Call {
  ms: number;
  status: number;
  body: string;
  cache: string | null;
  modelCalls: number | null;
  modelCostUsdc: number | null;
}

interface CaseResult {
  id: string;
  skipped?: string;
  error?: string;
  first?: Call;
  repeat?: Call;
  answer?: Answer;
  outcomeOk?: boolean;
  safeClaim?: boolean;
  identicalRepeat?: boolean;
  recall?: { expected: number; matched: number; unmatched: ExpectedEntry[] };
  evidence?: { checked: number; present: number; failures: string[] };
  invented: string[];
  coverageProblems: string[];
  securityProblems: string[];
}

const SAFE_CLAIM = /safe to upgrade|upgrade is safe|no breaking changes|nothing breaks|you can upgrade safely/gi;
// "This is not a sign that the upgrade is safe" is the opposite of a claim.
const NEGATED = /\b(not|never|no)\b[^.]{0,40}$|n't[^.]{0,40}$/i;

function claimsSafeUpgrade(text: string): boolean {
  return [...text.matchAll(SAFE_CLAIM)].some((m) => !NEGATED.test(text.slice(Math.max(0, m.index - 60), m.index)));
}
const STOP_WORDS = new Set("the and for are was were has have been with from that this now not its into when".split(" "));

const args = process.argv.slice(2);
const baseUrl = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, "");
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const repeat = !args.includes("--no-repeat");
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(tmpdir(), "miner-bench");
const key = process.env.MINER_API_KEY;
if (!baseUrl || !key) {
  console.error("usage: MINER_API_KEY=... pnpm bench <miner url> [--only p01,n03] [--no-repeat] [--out <dir>]");
  process.exit(2);
}

const benchDir = new URL(".", import.meta.url).pathname;
const transitions = JSON.parse(readFileSync(join(benchDir, "transitions.json"), "utf8")) as { cases: BenchCase[] };

// ---- text helpers -----------------------------------------------------------------------------------------

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Comparable text: HTML and Markdown markup removed, quotes unified, whitespace collapsed, lower case. */
function comparable(text: string, isPage: boolean): string {
  let out = text;
  if (isPage) {
    out = out.replace(/<\/?(code|a|em|strong|span|b|i|kbd)\b[^>]*>/gi, ""); // inline tags join their text
    out = decodeEntities(out.replace(/<[^>]+>/g, " "));
  }
  out = out
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/ ([.,:;)])/g, "$1");
  return out.trim().toLowerCase();
}

function words(text: string): Set<string> {
  return new Set(
    comparable(text, false)
      .split(/[^a-z0-9.@/-]+/)
      .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
  );
}

// ---- upstream reads (independent of the miner) ------------------------------------------------------------

const githubHeaders: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "miner-bench" };
if (process.env.GITHUB_TOKEN) githubHeaders.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const pageCache = new Map<string, Promise<{ status: number; text: string }>>();

/** The text a source URL stands for: release body, raw file, comparison commits and patches, or the page. */
function sourceText(url: string): Promise<{ status: number; text: string }> {
  const cached = pageCache.get(url);
  if (cached) return cached;
  const read = (async () => {
    const target = url.split("#")[0];
    const release = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/tag\/(.+)$/.exec(target);
    const blob = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/.exec(target);
    const compare = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/compare\/(.+)$/.exec(target);
    if (release) {
      const res = await fetch(`https://api.github.com/repos/${release[1]}/releases/tags/${release[2]}`, { headers: githubHeaders });
      return { status: res.status, text: res.ok ? ((await res.json()) as { body?: string }).body ?? "" : "" };
    }
    if (compare) {
      const res = await fetch(`https://api.github.com/repos/${compare[1]}/compare/${compare[2]}`, { headers: githubHeaders });
      if (!res.ok) return { status: res.status, text: "" };
      const body = (await res.json()) as { commits?: { commit: { message: string } }[]; files?: { filename: string; patch?: string }[] };
      const commits = (body.commits ?? []).map((c) => c.commit.message);
      const files = (body.files ?? []).map((f) => `--- ${f.filename}\n${f.patch ?? ""}`);
      return { status: res.status, text: [...commits, ...files].join("\n") };
    }
    const res = await fetch(blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}` : target, {
      headers: { "user-agent": "miner-bench" },
    });
    return { status: res.status, text: res.ok ? await res.text() : "" };
  })();
  pageCache.set(url, read);
  return read;
}

const packuments = new Map<string, Promise<{ versions: string[]; time: Record<string, string> } | null>>();
function packument(name: string) {
  if (!packuments.has(name)) {
    packuments.set(
      name,
      fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`).then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { versions: Record<string, unknown>; time: Record<string, string> };
        return { versions: Object.keys(body.versions), time: body.time };
      })
    );
  }
  return packuments.get(name)!;
}

async function osvIds(name: string, version: string): Promise<Set<string>> {
  const res = await fetch("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ package: { name, ecosystem: "npm" }, version }),
  });
  if (!res.ok) throw new Error(`OSV HTTP ${res.status}`);
  const body = (await res.json()) as { vulns?: { id: string; aliases?: string[] }[] };
  return new Set((body.vulns ?? []).flatMap((v) => [v.id, ...(v.aliases ?? [])]));
}

// ---- miner calls ------------------------------------------------------------------------------------------

async function ask(query: string): Promise<Call> {
  const started = performance.now();
  const res = await fetch(`${baseUrl}/api/answer?${new URLSearchParams({ query })}`, {
    headers: { "x-telegraph-key": key! },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  const header = (name: string) => res.headers.get(name);
  const number = (name: string) => (header(name) === null ? null : Number(header(name)));
  return {
    ms: Math.round(performance.now() - started),
    status: res.status,
    body,
    cache: header("x-miner-cache"),
    modelCalls: number("x-miner-model-calls"),
    modelCostUsdc: number("x-miner-model-cost-usdc"),
  };
}

// ---- checks -----------------------------------------------------------------------------------------------

/** An expected entry is found when an answer item of the same version quotes it, or says most of what it says. */
function matches(expected: ExpectedEntry, item: ChangeItem): boolean {
  if (item.version !== expected.version) return false;
  const quote = comparable(expected.quote, false);
  const excerpt = comparable(item.excerpt ?? "", false);
  if (excerpt !== "" && (excerpt.includes(quote) || (excerpt.length >= 20 && quote.includes(excerpt)))) return true;
  const wanted = words(`${expected.change} ${expected.quote}`);
  const said = words(`${item.change} ${item.excerpt ?? ""}`);
  const shared = [...wanted].filter((w) => said.has(w)).length;
  return wanted.size > 0 && shared / wanted.size >= 0.5;
}

function recallOf(expected: ExpectedEntry[], answer: Answer): CaseResult["recall"] {
  const unused = answer.changes.filter((c) => c.kind === "breaking");
  const unmatched: ExpectedEntry[] = [];
  for (const entry of expected) {
    const index = unused.findIndex((item) => matches(entry, item));
    if (index === -1) unmatched.push(entry);
    else unused.splice(index, 1);
  }
  return { expected: expected.length, matched: expected.length - unmatched.length, unmatched };
}

async function evidenceOf(answer: Answer): Promise<CaseResult["evidence"]> {
  const from = answer.request?.fromResolved;
  const to = answer.request?.toResolved;
  let checked = 0;
  let present = 0;
  const failures: string[] = [];
  for (const item of answer.changes) {
    if (item.evidenceType === "inferred" || item.excerpt === null) continue;
    checked += 1;
    const source = answer.sources.find((s) => s.id === item.sourceId)!;
    const page = await sourceText(source.url);
    const isPage = !/\/releases\/tag\/|\/compare\/|\/blob\/|raw\.githubusercontent/.test(source.url);
    const inSource = comparable(page.text, isPage).includes(comparable(item.excerpt, false));
    const inRange =
      from != null &&
      to != null &&
      semver.valid(item.version) !== null &&
      semver.gt(item.version, from) &&
      semver.lte(item.version, to) &&
      (source.versionTo === null || semver.valid(source.versionTo) === null || semver.lte(item.version, source.versionTo));
    if (inSource && inRange) present += 1;
    else failures.push(`${item.id} ${item.version}: ${inSource ? "" : "excerpt not in source "}${inRange ? "" : "version out of range "}(${source.url})`);
  }
  return { checked, present, failures };
}

async function inventedIn(answer: Answer): Promise<string[]> {
  const invented: string[] = [];
  const request = answer.request;
  if (request === null) return invented;
  const registry = await packument(request.package);
  if (registry === null) return invented;
  for (const item of answer.changes) {
    if (!registry.versions.includes(item.version)) invented.push(`${item.id}: version ${item.version} is not published`);
  }
  if (answer.targetReleasedAt !== null && request.toResolved !== null && answer.targetReleasedAt !== registry.time[request.toResolved]) {
    invented.push(`targetReleasedAt ${answer.targetReleasedAt} is not the registry date ${registry.time[request.toResolved]}`);
  }
  for (const source of answer.sources) {
    if (source.type === "registry" || source.type === "advisory") continue;
    const page = await sourceText(source.url);
    if (page.status >= 400) invented.push(`${source.id}: ${source.url} answers HTTP ${page.status}`);
  }
  return invented;
}

async function coverageProblemsIn(answer: Answer, benchCase: BenchCase): Promise<string[]> {
  const problems: string[] = [];
  const coverage = answer.coverage;
  for (const version of benchCase.expected.notCoveredMustInclude ?? []) {
    if (!coverage?.notCovered.some((n) => n.version === version)) problems.push(`${version} is not named as not covered`);
  }
  const request = answer.request;
  if (coverage === null || request?.fromResolved == null || request.toResolved == null) return problems;
  const registry = await packument(request.package);
  if (registry === null) return problems;
  const named = new Set([...coverage.covered, ...coverage.notCovered.map((n) => n.version)]);
  const unnamed = releasesBetween(registry.versions, request.fromResolved, request.toResolved).filter((v) => !named.has(v));
  if (unnamed.length > 0) problems.push(`releases neither covered nor named as not covered: ${unnamed.join(", ")}`);
  if (!coverage.complete && coverage.notCovered.length === 0) problems.push("coverage is partial but names no uncovered release");
  return problems;
}

async function securityProblemsIn(answer: Answer): Promise<string[]> {
  const problems: string[] = [];
  const { security, request } = answer;
  if (security.status !== "complete" && /no known advisories/i.test(answer.answer)) {
    problems.push(`security is ${security.status} but the answer says "no known advisories"`);
  }
  for (const item of answer.changes) {
    if (item.kind === "security_fix" && item.evidenceType === "inferred") problems.push(`${item.id}: security fix claimed without a quote`);
  }
  if (security.status !== "complete" || request?.fromResolved == null || request.toResolved == null) return problems;
  const [atFrom, atTarget] = await Promise.all([osvIds(request.package, request.fromResolved), osvIds(request.package, request.toResolved)]);
  const state = (ids: Set<string>, ids2: string[]) => (ids2.some((id) => ids.has(id)) ? "yes" : "no");
  for (const advisory of security.advisories) {
    const names = [advisory.id, ...advisory.aliases];
    const fromAffected = state(atFrom, names);
    const targetAffected = state(atTarget, names);
    const conclusion = fromAffected === "yes" ? (targetAffected === "yes" ? "still_affected" : "fixed_by_upgrade") : targetAffected === "yes" ? "introduced_by_upgrade" : "not_applicable";
    if (advisory.conclusion !== "unknown" && advisory.conclusion !== conclusion) {
      problems.push(`${advisory.id}: answer says ${advisory.conclusion}, OSV says ${conclusion}`);
    }
  }
  const reported = new Set(security.advisories.flatMap((a) => [a.id, ...a.aliases]));
  const missed = [...atFrom, ...atTarget].filter((id) => /^GHSA-/.test(id) && !reported.has(id));
  if (missed.length > 0) problems.push(`OSV advisories missing from the answer: ${[...new Set(missed)].join(", ")}`);
  return problems;
}

// ---- run --------------------------------------------------------------------------------------------------

async function runCase(benchCase: BenchCase): Promise<CaseResult> {
  const result: CaseResult = { id: benchCase.id, invented: [], coverageProblems: [], securityProblems: [] };
  if (benchCase.query === null) return { ...result, skipped: "no query yet" };
  if (benchCase.localOnly) return { ...result, skipped: "needs a local run with a simulated outage" };
  try {
    result.first = await ask(benchCase.query);
    if (repeat) result.repeat = await ask(benchCase.query);
  } catch (err) {
    return { ...result, error: String(err) };
  }
  if (result.first.status !== 200) return { ...result, error: `HTTP ${result.first.status}: ${result.first.body.slice(0, 200)}` };
  const parsed = Answer.safeParse(JSON.parse(result.first.body));
  if (!parsed.success) return { ...result, error: `answer does not match the schema: ${parsed.error.message.slice(0, 300)}` };
  const answer = parsed.data;
  result.answer = answer;
  writeFileSync(join(outDir, `${benchCase.id}.json`), result.first.body);

  const wanted = Array.isArray(benchCase.expected.outcome) ? benchCase.expected.outcome : [benchCase.expected.outcome];
  result.outcomeOk = wanted.includes(answer.outcome);
  result.safeClaim = claimsSafeUpgrade(`${answer.summary}\n${answer.answer}`);
  if (result.repeat) result.identicalRepeat = result.repeat.status === 200 && result.repeat.body === result.first.body;
  if (benchCase.expected.breaking) result.recall = recallOf(benchCase.expected.breaking, answer);
  result.evidence = await evidenceOf(answer);
  result.invented = await inventedIn(answer);
  result.coverageProblems = await coverageProblemsIn(answer, benchCase);
  result.securityProblems = await securityProblemsIn(answer);
  return result;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const mark = (ok: boolean) => (ok ? "pass" : "**FAIL**");

function report(results: CaseResult[], cases: Map<string, BenchCase>): string {
  const ran = results.filter((r) => r.answer);
  const positives = ran.filter((r) => r.id.startsWith("p"));
  const negatives = ran.filter((r) => r.id.startsWith("n"));
  const inBudget = (r: CaseResult) => !cases.get(r.id)?.tags?.includes("beyond_model_budget");

  const evidenceChecked = ran.reduce((n, r) => n + (r.evidence?.checked ?? 0), 0);
  const evidencePresent = ran.reduce((n, r) => n + (r.evidence?.present ?? 0), 0);
  const recallFor = (rs: CaseResult[]) => ({
    expected: rs.reduce((n, r) => n + (r.recall?.expected ?? 0), 0),
    matched: rs.reduce((n, r) => n + (r.recall?.matched ?? 0), 0),
  });
  const recallAll = recallFor(positives);
  const recallGate = recallFor(positives.filter(inBudget));
  const invented = ran.flatMap((r) => r.invented.map((i) => `${r.id} ${i}`));
  const negativeFailures = negatives.filter((r) => !r.outcomeOk || r.safeClaim);
  const coverageFailures = ran.filter((r) => r.coverageProblems.length > 0);
  const securityFailures = ran.filter((r) => r.securityProblems.length > 0);
  const firstTime = ran.filter((r) => r.first?.cache === "miss").map((r) => r.first!.ms);
  const firstCached = ran.filter((r) => r.first?.cache === "hit").map((r) => r.first!.ms);
  const repeats = ran.filter((r) => r.repeat).map((r) => r.repeat!.ms);
  const notIdentical = ran.filter((r) => r.identicalRepeat === false);
  const modelCalls = ran.reduce((n, r) => n + (r.first?.modelCalls ?? 0), 0);
  const firstCost = ran.filter((r) => r.first?.cache === "miss").reduce((n, r) => n + (r.first?.modelCostUsdc ?? 0), 0);
  const repeatCost = ran.reduce((n, r) => n + (r.repeat?.modelCostUsdc ?? 0), 0);
  const ms = (v: number | null) => (v === null ? "n/a" : `${v} ms`);

  const lines = [
    "# Benchmark report",
    "",
    `Run ${new Date().toISOString()} against ${baseUrl}, processing version ${ran[0]?.answer?.processingVersion ?? "n/a"}.`,
    `${ran.length} cases answered, ${results.filter((r) => r.skipped).length} skipped, ${results.filter((r) => r.error).length} failed. Written by \`bench/run.ts\`.`,
    "",
    "## Success criteria",
    "",
    "| Criterion | Result | Target | Status |",
    "| --- | --- | --- | --- |",
    `| SC-001 evidence: excerpt found in the cited source, at a version in range | ${evidencePresent}/${evidenceChecked} (${pct(evidencePresent, evidenceChecked)}) | ≥ 90% | ${mark(evidenceChecked === 0 || evidencePresent / evidenceChecked >= 0.9)} |`,
    `| SC-002 recall of reviewed breaking changes, cases within the model budget | ${recallGate.matched}/${recallGate.expected} (${pct(recallGate.matched, recallGate.expected)}) | ≥ 80% | ${mark(recallGate.expected === 0 || recallGate.matched / recallGate.expected >= 0.8)} |`,
    `| SC-002 recall, all positive cases (for information) | ${recallAll.matched}/${recallAll.expected} (${pct(recallAll.matched, recallAll.expected)}) | — | — |`,
    `| SC-003 invented versions, dates or links | ${invented.length} | 0 | ${mark(invented.length === 0)} |`,
    `| SC-004 negative cases with the right outcome and no safe-upgrade claim | ${negatives.length - negativeFailures.length}/${negatives.length} | all | ${mark(negativeFailures.length === 0)} |`,
    `| SC-005 answers whose coverage names every release in range | ${ran.length - coverageFailures.length}/${ran.length} | all | ${mark(coverageFailures.length === 0)} |`,
    `| SC-006 repeats byte-identical | ${ran.length - notIdentical.length}/${ran.filter((r) => r.repeat).length} | all | ${mark(notIdentical.length === 0)} |`,
    `| SC-006 repeat latency p95 | ${ms(percentile(repeats, 95))} | < 500 ms | ${mark((percentile(repeats, 95) ?? 0) < 500)} |`,
    `| SC-006 first-time latency p50 / p95 (${firstTime.length} answers) | ${ms(percentile(firstTime, 50))} / ${ms(percentile(firstTime, 95))} | published; 2 s where the intent requires it | — |`,
    `| SC-008 security tests | see \`test/unit/security.test.ts\` | no private-network request, no package execution, no injection | — |`,
    `| SC-011 model calls and cost, first-time answers | ${modelCalls} calls, ${firstCost.toFixed(4)} USDC | reported against the payout per answer | — |`,
    `| SC-011 model cost, repeats | ${repeatCost.toFixed(4)} USDC | 0 | ${mark(repeatCost === 0)} |`,
    `| SC-012 security conclusions match OSV and the US4 table | ${ran.length - securityFailures.length}/${ran.length} | all | ${mark(securityFailures.length === 0)} |`,
    "",
    `First calls that were already cached on this processing version: ${firstCached.length} (p50 ${ms(percentile(firstCached, 50))}); they are left out of first-time latency and cost.`,
    "",
    "SC-001 is checked mechanically: the excerpt is in the source text fetched by this harness and the item's version is in range. Whether the excerpt supports the stated change and migration needs a reader.",
    "SC-002 matches an expected entry to an answer item of the same version when the item's excerpt contains the expected quote, or shares at least half of its significant words; unmatched entries are listed below for a reader to confirm.",
    "",
    "## Cases",
    "",
    "| Case | Outcome (expected) | First call | Repeat | Breaking found | Evidence | Problems |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    const expected = cases.get(r.id)!.expected.outcome;
    if (r.skipped || r.error) {
      lines.push(`| ${r.id} | — (${[expected].flat().join(" or ")}) | ${r.skipped ? `skipped: ${r.skipped}` : `error: ${r.error}`} | | | | |`);
      continue;
    }
    const problems = [
      r.outcomeOk ? "" : "wrong outcome",
      r.safeClaim ? "safe-upgrade claim" : "",
      r.identicalRepeat === false ? "repeat differs" : "",
      r.invented.length ? `${r.invented.length} invented` : "",
      r.coverageProblems.length ? "coverage" : "",
      r.securityProblems.length ? "security" : "",
    ].filter(Boolean);
    const first = r.first!;
    lines.push(
      `| ${r.id} | ${r.answer!.outcome} (${[expected].flat().join(" or ")}) | ${first.ms} ms, ${first.cache ?? "?"}, ${first.modelCalls ?? "?"} model calls | ${r.repeat ? `${r.repeat.ms} ms, ${r.repeat.cache ?? "?"}` : "—"} | ${r.recall ? `${r.recall.matched}/${r.recall.expected}` : "—"} | ${r.evidence ? `${r.evidence.present}/${r.evidence.checked}` : "—"} | ${problems.join(", ") || "none"} |`
    );
  }
  lines.push("", "## Details", "");
  for (const r of results) {
    const details = [
      ...(r.recall?.unmatched ?? []).map((e) => `not found: ${e.version} ${e.change}`),
      ...(r.evidence?.failures ?? []).map((f) => `evidence: ${f}`),
      ...r.invented.map((i) => `invented: ${i}`),
      ...r.coverageProblems.map((p) => `coverage: ${p}`),
      ...r.securityProblems.map((p) => `security: ${p}`),
    ];
    if (details.length === 0) continue;
    lines.push(`### ${r.id}`, "", ...details.map((d) => `- ${d}`), "");
  }
  return lines.join("\n") + "\n";
}

mkdirSync(outDir, { recursive: true });
const selected = transitions.cases.filter((c) => only === null || only.has(c.id));
const results: CaseResult[] = [];
for (const benchCase of selected) {
  const result = await runCase(benchCase);
  results.push(result);
  const first = result.first;
  console.log(
    `${benchCase.id} ${result.skipped ? `skipped: ${result.skipped}` : result.error ? `error: ${result.error}` : `${result.answer!.outcome} ${first!.ms}ms ${first!.cache} recall ${result.recall ? `${result.recall.matched}/${result.recall.expected}` : "-"}`}`
  );
}
const reportPath = join(benchDir, "report.md");
writeFileSync(reportPath, report(results, new Map(transitions.cases.map((c) => [c.id, c]))));
console.log(`wrote ${reportPath}; answers in ${outDir}`);
