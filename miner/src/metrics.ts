// One structured log line per request (FR-027). Never receives keys or tokens.
import { MetricsRecord } from "./types.js";

export function writeMetrics(record: MetricsRecord): void {
  console.log(JSON.stringify({ kind: "miner_metrics", ...MetricsRecord.parse(record) }));
}
