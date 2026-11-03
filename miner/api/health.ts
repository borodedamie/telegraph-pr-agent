// GET /api/health — public, cached upstream probes (contracts/answer-endpoint.md).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getStore } from "../src/cache.js";
import { getHealth } from "../src/probe.js";

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const health = await getHealth(getStore());
  res.status(health.ok ? 200 : 503).json(health);
}
