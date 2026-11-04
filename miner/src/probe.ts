// Cached upstream probes behind GET /api/health (contracts/answer-endpoint.md).
import { z } from "zod";
import type { Store } from "./cache.js";
import { safeFetch } from "./safeFetch.js";
import { PROCESSING_VERSION } from "./version.js";

const UpstreamState = z.enum(["ok", "down"]);

export const Health = z.object({
  ok: z.boolean(),
  processingVersion: z.string(),
  probedAt: z.string(),
  upstreams: z.object({ npm: UpstreamState, github: UpstreamState, osv: UpstreamState, redis: UpstreamState }),
});
export type Health = z.infer<typeof Health>;

export const PROBE_TTL_MS = 5 * 60 * 1000;
const PROBE_KEY = "probe:last";
const PROBE_REFRESH_KEY = "probe:refresh";
const PROBE_TIMEOUT_MS = 3_000;

type Fetcher = typeof safeFetch;

async function probeHttp(fetcher: Fetcher, url: string, init: Parameters<Fetcher>[1]): Promise<"ok" | "down"> {
  try {
    const response = await fetcher(url, { ...init, timeoutMs: PROBE_TIMEOUT_MS });
    return response.status === 200 ? "ok" : "down";
  } catch (err) {
    console.warn(JSON.stringify({ kind: "probe_failed", url, error: String(err) }));
    return "down";
  }
}

async function probeRedis(store: Store): Promise<"ok" | "down"> {
  try {
    return (await store.ping()) ? "ok" : "down";
  } catch (err) {
    console.warn(JSON.stringify({ kind: "probe_failed", url: "redis", error: String(err) }));
    return "down";
  }
}

export async function runProbes(store: Store, fetcher: Fetcher, now: number, env: NodeJS.ProcessEnv): Promise<Health> {
  const githubHeaders: Record<string, string> = { accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) githubHeaders.authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const [npm, github, osv, redis] = await Promise.all([
    probeHttp(fetcher, "https://registry.npmjs.org/-/ping", {}),
    probeHttp(fetcher, "https://api.github.com/rate_limit", { headers: githubHeaders }),
    probeHttp(fetcher, "https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name: "lodash", ecosystem: "npm" }, version: "4.17.21" }),
    }),
    probeRedis(store),
  ]);
  return {
    ok: npm === "ok" && redis === "ok",
    processingVersion: PROCESSING_VERSION,
    probedAt: new Date(now).toISOString(),
    upstreams: { npm, github, osv, redis },
  };
}

async function readCached(store: Store): Promise<Health | null> {
  try {
    const raw = await store.get(PROBE_KEY);
    return raw === null ? null : Health.parse(JSON.parse(raw));
  } catch (err) {
    console.warn(JSON.stringify({ kind: "probe_cache_unreadable", error: String(err) }));
    return null;
  }
}

// Last probe per store (one store per instance), so each instance probes at most once per window
// even when the shared cache cannot be read or written.
const instanceHealth = new WeakMap<Store, Health>();

function newer(a: Health | null, b: Health | undefined): Health | null {
  if (!b) return a;
  if (!a) return b;
  return Date.parse(b.probedAt) > Date.parse(a.probedAt) ? b : a;
}

/** Serves probes at most PROBE_TTL_MS old; unauthenticated callers trigger at most one refresh per window. */
export async function getHealth(
  store: Store,
  fetcher: Fetcher = safeFetch,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env
): Promise<Health> {
  const cached = newer(await readCached(store), instanceHealth.get(store));
  if (cached && now - Date.parse(cached.probedAt) < PROBE_TTL_MS) return cached;

  let mayRefresh = true;
  try {
    mayRefresh = await store.setNx(PROBE_REFRESH_KEY, "1", PROBE_TTL_MS / 1000);
  } catch (err) {
    console.warn(JSON.stringify({ kind: "probe_refresh_lock_failed", error: String(err) }));
  }
  if (!mayRefresh && cached) return cached;

  const fresh = await runProbes(store, fetcher, now, env);
  instanceHealth.set(store, fresh);
  try {
    await store.set(PROBE_KEY, JSON.stringify(fresh));
  } catch (err) {
    console.warn(JSON.stringify({ kind: "probe_cache_write_failed", error: String(err) }));
  }
  return fresh;
}
