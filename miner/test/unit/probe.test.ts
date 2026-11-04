import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/cache.js";
import { PROBE_TTL_MS, getHealth } from "../../src/probe.js";
import { Upstream, type SafeResponse } from "../../src/safeFetch.js";

function fetcherCounting(failing: string[] = []) {
  const calls: string[] = [];
  const fetcher = async (url: string): Promise<SafeResponse> => {
    calls.push(url);
    if (failing.some((f) => url.includes(f))) throw new Upstream(503, url);
    return { status: 200, url, headers: {}, body: "{}", notModified: false };
  };
  return { fetcher, calls };
}

describe("getHealth", () => {
  it("probes every upstream and reports ok", async () => {
    const { fetcher, calls } = fetcherCounting();
    const health = await getHealth(new MemoryStore(), fetcher, Date.parse("2026-11-03T12:00:00Z"), {});
    expect(health.ok).toBe(true);
    expect(health.upstreams).toEqual({ npm: "ok", github: "ok", osv: "ok", redis: "ok" });
    expect(calls).toHaveLength(3);
  });

  it("serves cached probes for five minutes, then refreshes", async () => {
    const store = new MemoryStore();
    const { fetcher, calls } = fetcherCounting();
    const t0 = Date.parse("2026-11-03T12:00:00Z");
    await getHealth(store, fetcher, t0, {});
    await getHealth(store, fetcher, t0 + PROBE_TTL_MS - 1, {});
    expect(calls).toHaveLength(3);
    // The refresh lock lives in the store's own clock; a fresh store stands in for its expiry.
    const later = new MemoryStore(() => t0 + PROBE_TTL_MS + 1);
    await later.set("probe:last", (await store.get("probe:last"))!);
    await getHealth(later, fetcher, t0 + PROBE_TTL_MS + 1, {});
    expect(calls).toHaveLength(6);
  });

  it("reports a failing upstream as down; registry down makes the miner unhealthy", async () => {
    const { fetcher } = fetcherCounting(["registry.npmjs.org"]);
    const health = await getHealth(new MemoryStore(), fetcher, Date.now(), {});
    expect(health.upstreams.npm).toBe("down");
    expect(health.ok).toBe(false);
  });

  it("probes at most once per window per instance when the shared cache is down", async () => {
    const { fetcher, calls } = fetcherCounting();
    const broken = new MemoryStore();
    broken.get = async () => {
      throw new Error("redis down");
    };
    broken.setNx = async () => {
      throw new Error("redis down");
    };
    const t0 = Date.parse("2026-11-03T12:00:00Z");
    await getHealth(broken, fetcher, t0, {});
    await getHealth(broken, fetcher, t0 + 1_000, {});
    await getHealth(broken, fetcher, t0 + 2_000, {});
    expect(calls).toHaveLength(3);
  });
});
