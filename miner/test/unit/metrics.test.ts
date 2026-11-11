import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/cache.js";
import { METRICS_KEPT, METRICS_KEY, writeFailure, writeMetrics } from "../../src/metrics.js";
import type { MetricsRecord } from "../../src/types.js";

const RECORD: MetricsRecord = {
  requestHash: "h1", authOk: true, headerNames: ["x-telegraph-key"], cacheHit: false, outcome: "found", declaredFailure: false,
  extractorMode: "rules_and_model", msResolve: 1, msFetch: 2, msModel: 3, msTotal: 6, upstreamRequests: 4, conditionalHits: 0,
  llmMinerId: "7413", modelCalls: 1, modelInputChars: 100, modelCostUsdc: 0.01, llmFailure: null, budgetExhausted: null,
  package: "zod", fromVersion: "3.23.8", toVersion: "4.0.0", changes: 3, confidence: 0.8, releasesCovered: 2, notCovered: { truncated: 1 },
  rulesItems: 2, modelItems: 2, modelItemsKept: 1, modelDrops: { "excerpt not in source": 1 },
  modelSectionsCut: 1, modelSectionsSkipped: 0, modelSectionsFailed: 0,
};

describe("metrics records", () => {
  it("keeps each record and failure in the store, newest first", async () => {
    const store = new MemoryStore();
    await writeMetrics(store, RECORD, new Date("2026-11-11T10:00:00Z"));
    await writeFailure(store, { kind: "answer_failed", requestHash: "h2", error: "boom" }, new Date("2026-11-11T10:01:00Z"));
    const [failure, record] = (await store.list(METRICS_KEY)).map((line) => JSON.parse(line));
    expect(failure).toEqual({ kind: "answer_failed", requestHash: "h2", error: "boom", at: "2026-11-11T10:01:00.000Z" });
    expect(record).toEqual({ kind: "miner_metrics", at: "2026-11-11T10:00:00.000Z", ...RECORD });
  });

  it("keeps only the newest records", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < METRICS_KEPT + 2; i++) await store.pushCapped(METRICS_KEY, String(i), METRICS_KEPT);
    const kept = await store.list(METRICS_KEY);
    expect(kept.length).toBe(METRICS_KEPT);
    expect(kept[0]).toBe(String(METRICS_KEPT + 1));
  });

  it("answers even when the store cannot keep the record", async () => {
    const store = new MemoryStore();
    store.pushCapped = async () => {
      throw new Error("store down");
    };
    await expect(writeMetrics(store, RECORD)).resolves.toBeUndefined();
  });
});
