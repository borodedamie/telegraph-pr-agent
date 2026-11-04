// GET /api/health — public, cached upstream probes (contracts/answer-endpoint.md).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStore } from "../src/cache.js";
import { getHealth } from "../src/probe.js";

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  let store;
  try {
    store = getStore();
  } catch (err) {
    console.error(JSON.stringify({ kind: "store_unavailable", error: String(err) }));
    res.status(503).json({ ok: false, error: "miner storage not configured" });
    return;
  }
  const health = await getHealth(store);
  res.status(health.ok ? 200 : 503).json(health);
}
