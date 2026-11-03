// GET /api/answer — Telegraph path /answer (contracts/answer-endpoint.md).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { admit, admitLimitsFromEnv, checkKey } from "../src/auth.js";
import { getStore, sha256Hex } from "../src/cache.js";
import { writeMetrics } from "../src/metrics.js";
import { stubAnswer } from "../src/stub.js";
import { Answer } from "../src/types.js";

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
  try {
    limits = admitLimitsFromEnv();
  } catch (err) {
    console.error(JSON.stringify({ kind: "config_invalid", error: String(err) }));
    res.status(500).json({ error: "miner misconfigured" });
    return;
  }

  try {
    const admission = await admit(getStore(), limits);
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

  const answer = Answer.parse(stubAnswer());
  writeMetrics({
    requestHash: sha256Hex(query),
    authOk: true,
    cacheHit: false,
    outcome: answer.outcome,
    declaredFailure: false,
    extractorMode: null,
    msResolve: 0,
    msFetch: 0,
    msModel: 0,
    msTotal: Date.now() - startedAt,
    upstreamRequests: 0,
    conditionalHits: 0,
    llmMinerId: null,
    modelCalls: 0,
    modelInputChars: 0,
    modelCostUsdc: 0,
    llmFailure: null,
    budgetExhausted: null,
  });
  res.status(200).json(answer);
}
