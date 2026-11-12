// Live traffic summary: reads the metrics records the miner keeps in its store (src/metrics.ts) and prints
// what was asked, how it was answered and what the LLM added.
//
//   pnpm stats [--since 2026-11-11] [--json]
//
// Needs KV_REST_API_URL and KV_REST_API_READ_ONLY_TOKEN (or KV_REST_API_TOKEN), as in miner/.env.local:
//   (pnpm stats loads miner/.env.local itself)
import { Redis } from "@upstash/redis";
import { RedisStore } from "../src/cache.js";
import { METRICS_KEY } from "../src/metrics.js";
import { MetricsRecord } from "../src/types.js";

type MetricsLine = MetricsRecord & { kind: "miner_metrics"; at: string };
interface Failure {
  kind: "compute_refused" | "answer_failed";
  at: string;
  requestHash: string;
  reason?: string;
  error?: string;
}

function option(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function tally(keys: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([, a], [, b]) => b - a));
}

function sumCounts(maps: Record<string, number>[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const map of maps) for (const [key, n] of Object.entries(map)) total[key] = (total[key] ?? 0) + n;
  return total;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function ratio(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV_REST_API_URL and KV_REST_API_READ_ONLY_TOKEN (or KV_REST_API_TOKEN) are required");
  const store = new RedisStore(new Redis({ url, token, automaticDeserialization: false }));
  const since = option("--since");

  const lines = (await store.list(METRICS_KEY)).map((line) => JSON.parse(line) as { kind: string; at: string });
  const inRange = lines.filter((line) => since === null || line.at >= since);
  const records = inRange.filter((line): line is MetricsLine => line.kind === "miner_metrics");
  const failures = inRange.filter((line): line is Failure => line.kind !== "miner_metrics");

  const firstTime = records.filter((r) => !r.cacheHit);
  const repeats = records.filter((r) => r.cacheHit);
  // A call refused on price is taken off modelCalls but leaves llmFailure, so such answers still count here.
  const withModel = firstTime.filter((r) => r.modelCalls > 0 || r.llmFailure !== null);
  const modelItems = sum(withModel.map((r) => r.modelItems));
  const modelKept = sum(withModel.map((r) => r.modelItemsKept));
  const changesWithModel = sum(withModel.map((r) => r.changes));

  const summary = {
    period: { from: records.at(-1)?.at ?? null, to: records[0]?.at ?? null, since },
    requests: { answered: records.length, firstTime: firstTime.length, repeats: repeats.length, failures: tally(failures.map((f) => f.kind)) },
    outcomes: tally(records.map((r) => r.outcome ?? "none")),
    latencyMs: {
      firstTime: { p50: percentile(firstTime.map((r) => r.msTotal), 50), p95: percentile(firstTime.map((r) => r.msTotal), 95) },
      repeat: { p50: percentile(repeats.map((r) => r.msTotal), 50), p95: percentile(repeats.map((r) => r.msTotal), 95) },
    },
    llm: {
      answersThatTriedIt: withModel.length,
      calls: sum(withModel.map((r) => r.modelCalls)),
      costUsdc: Number(sum(withModel.map((r) => r.modelCostUsdc)).toFixed(4)),
      miners: tally(withModel.map((r) => r.llmMinerId ?? "none")),
      failures: tally(withModel.flatMap((r) => (r.llmFailure ? [r.llmFailure] : []))),
      msModel: { p50: percentile(withModel.map((r) => r.msModel), 50), p95: percentile(withModel.map((r) => r.msModel), 95) },
      itemsReturned: modelItems,
      itemsKept: modelKept,
      keptRate: ratio(modelKept, modelItems),
      drops: sumCounts(withModel.map((r) => r.modelDrops)),
      answersWhereItAddedSomething: withModel.filter((r) => r.modelItemsKept > 0).length,
      shareOfChangesFromLlm: ratio(modelKept, changesWithModel),
      sectionsCut: sum(withModel.map((r) => r.modelSectionsCut)),
      sectionsSkipped: sum(withModel.map((r) => r.modelSectionsSkipped)),
      sectionsFailed: sum(withModel.map((r) => r.modelSectionsFailed)),
    },
    notCovered: sumCounts(firstTime.map((r) => r.notCovered)),
    packages: tally(records.map((r) => r.package ?? "(none)")),
    headerNames: tally(records.flatMap((r) => r.headerNames)),
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const { requests, llm } = summary;
  console.log(`Records ${summary.period.from ?? "-"} to ${summary.period.to ?? "-"}${since ? ` (since ${since})` : ""}`);
  console.log(`Answered ${requests.answered}: ${requests.firstTime} first-time, ${requests.repeats} from cache. No answer: ${JSON.stringify(requests.failures)}`);
  console.log(`Outcomes ${JSON.stringify(summary.outcomes)}`);
  console.log(`Latency ms: first-time p50 ${summary.latencyMs.firstTime.p50} p95 ${summary.latencyMs.firstTime.p95}; repeat p50 ${summary.latencyMs.repeat.p50} p95 ${summary.latencyMs.repeat.p95}`);
  console.log(`LLM: tried on ${llm.answersThatTriedIt} answers, ${llm.calls} calls, ${llm.costUsdc} USDC, miners ${JSON.stringify(llm.miners)}, failures ${JSON.stringify(llm.failures)}, ms p50 ${llm.msModel.p50} p95 ${llm.msModel.p95}`);
  console.log(`LLM items: ${llm.itemsReturned} returned, ${llm.itemsKept} kept (${llm.keptRate}), dropped ${JSON.stringify(llm.drops)}`);
  console.log(`LLM added something on ${llm.answersWhereItAddedSomething} of ${llm.answersThatTriedIt} answers; ${llm.shareOfChangesFromLlm} of those answers' changes came from it`);
  console.log(`LLM sections: ${llm.sectionsCut} cut short, ${llm.sectionsSkipped} skipped for budget, ${llm.sectionsFailed} failed`);
  console.log(`Not covered (first-time) ${JSON.stringify(summary.notCovered)}`);
  console.log(`Packages ${JSON.stringify(summary.packages)}`);
  console.log(`Header names ${JSON.stringify(summary.headerNames)}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
