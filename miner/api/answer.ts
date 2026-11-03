// GET /api/answer — Telegraph path /answer (contracts/answer-endpoint.md).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ComputeRefused, answerQuestion } from "../src/answer.js";
import { admit, admitLimitsFromEnv, checkKey, enterCompute, leaveCompute } from "../src/auth.js";
import { limitsFromEnv } from "../src/budget.js";
import { getStore, lockTtlSec, sha256Hex } from "../src/cache.js";
import { writeMetrics } from "../src/metrics.js";

const MAX_QUERY_CHARS = 2_000;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const startedAt = Date.now();

  const auth = checkKey(single(req.headers["x-telegraph-key"]));
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.reason });
    return;
  }

  let limits;
  let budgetLimits;
  try {
    limits = admitLimitsFromEnv();
    budgetLimits = limitsFromEnv();
  } catch (err) {
    console.error(JSON.stringify({ kind: "config_invalid", error: String(err) }));
    res.status(500).json({ error: "miner misconfigured" });
    return;
  }

  let store;
  try {
    store = getStore();
    const admission = await admit(store, limits);
    if (!admission.ok) {
      res.status(429).json({ error: admission.reason });
      return;
    }
  } catch (err) {
    // The miner's own store is down or not configured: a miner failure, not an upstream outage.
    console.error(JSON.stringify({ kind: "admission_failed", error: String(err) }));
    res.status(503).json({ error: "miner storage unavailable" });
    return;
  }

  const query = single(req.query.query as string | string[] | undefined);
  if (query === undefined || query.trim() === "") {
    res.status(400).json({ error: "query is required" });
    return;
  }
  if (query.length > MAX_QUERY_CHARS) {
    res.status(400).json({ error: `query is longer than ${MAX_QUERY_CHARS} characters` });
    return;
  }

  const requestHash = sha256Hex(query);
  try {
    const result = await answerQuestion(query, {
      store,
      env: process.env,
      limits: budgetLimits,
      startedAt,
      enterCompute: async () => {
        const slot = await enterCompute(store, limits, lockTtlSec(budgetLimits.maxTimeMs));
        if (!slot.ok) throw new ComputeRefused(slot.reason);
        return () => leaveCompute(store, slot.slot);
      },
    });
    writeMetrics({ requestHash, authOk: true, msTotal: Date.now() - startedAt, ...result.metrics });
    // Send the stored string itself, so a cache hit is byte-identical (FR-018).
    res.status(200).setHeader("content-type", "application/json; charset=utf-8").send(result.json);
  } catch (err) {
    if (err instanceof ComputeRefused) {
      res.status(429).json({ error: err.reason });
      return;
    }
    console.error(JSON.stringify({ kind: "answer_failed", requestHash, error: String(err), stack: (err as Error).stack }));
    res.status(500).json({ error: "internal error", requestHash });
  }
}
