// One structured log line per request (FR-027). Never receives keys or tokens.
import type { Store } from "./cache.js";
import { MetricsRecord } from "./types.js";

/** Vercel keeps runtime logs only briefly, so each record is also kept in the store: the newest of these many. */
export const METRICS_KEY = "metrics:requests";
export const METRICS_KEPT = 10_000;
/** The answer waits for the stats write at most this long: a slow store must not hold back a paid answer. */
export const METRICS_WRITE_TIMEOUT_MS = 500;

async function keep(store: Store, line: string, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs)));
  try {
    const outcome = await Promise.race([store.pushCapped(METRICS_KEY, line, METRICS_KEPT), timeout]);
    if (outcome === "timeout") console.warn(JSON.stringify({ kind: "metrics_store_slow", timeoutMs }));
  } catch (err) {
    // The answer is already computed: a lost stats line must not fail it, but it is reported.
    console.warn(JSON.stringify({ kind: "metrics_store_failed", error: String(err) }));
  } finally {
    clearTimeout(timer);
  }
}

export async function writeMetrics(
  store: Store, record: MetricsRecord, at: Date = new Date(), timeoutMs = METRICS_WRITE_TIMEOUT_MS
): Promise<void> {
  const line = JSON.stringify({ kind: "miner_metrics", at: at.toISOString(), ...MetricsRecord.parse(record) });
  console.log(line);
  await keep(store, line, timeoutMs);
}

/** A request that got no answer (refused or failed), kept next to the metrics records so the counts add up. */
export async function writeFailure(
  store: Store,
  failure: { kind: "compute_refused" | "answer_failed"; requestHash: string; reason?: string; error?: string },
  at: Date = new Date(),
  timeoutMs = METRICS_WRITE_TIMEOUT_MS
): Promise<void> {
  await keep(store, JSON.stringify({ ...failure, at: at.toISOString() }), timeoutMs);
}
