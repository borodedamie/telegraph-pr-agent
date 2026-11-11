// One structured log line per request (FR-027). Never receives keys or tokens.
import type { Store } from "./cache.js";
import { MetricsRecord } from "./types.js";

/** Vercel keeps runtime logs only briefly, so each record is also kept in the store: the newest of these many. */
export const METRICS_KEY = "metrics:requests";
export const METRICS_KEPT = 10_000;

export async function writeMetrics(store: Store, record: MetricsRecord, at: Date = new Date()): Promise<void> {
  const line = JSON.stringify({ kind: "miner_metrics", at: at.toISOString(), ...MetricsRecord.parse(record) });
  console.log(line);
  try {
    await store.pushCapped(METRICS_KEY, line, METRICS_KEPT);
  } catch (err) {
    // The answer is already computed: a lost stats line must not fail it, but it is reported.
    console.warn(JSON.stringify({ kind: "metrics_store_failed", error: String(err) }));
  }
}

/** A request that got no answer (refused or failed), kept next to the metrics records so the counts add up. */
export async function writeFailure(
  store: Store,
  failure: { kind: "compute_refused" | "answer_failed"; requestHash: string; reason?: string; error?: string },
  at: Date = new Date()
): Promise<void> {
  try {
    await store.pushCapped(METRICS_KEY, JSON.stringify({ ...failure, at: at.toISOString() }), METRICS_KEPT);
  } catch (err) {
    console.warn(JSON.stringify({ kind: "metrics_store_failed", error: String(err) }));
  }
}
