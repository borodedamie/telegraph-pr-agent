import { describe, expect, it } from "vitest";
import { admit, admitLimitsFromEnv, checkKey, enterCompute, leaveCompute } from "../../src/auth.js";
import { MemoryStore } from "../../src/cache.js";

const env = { MINER_API_KEY: "right-key" };

describe("checkKey", () => {
  it("rejects a missing or wrong key", () => {
    expect(checkKey(undefined, env)).toMatchObject({ ok: false, status: 401 });
    expect(checkKey("wrong-key", env)).toMatchObject({ ok: false, status: 401 });
    expect(checkKey("right-key-but-longer", env)).toMatchObject({ ok: false, status: 401 });
  });

  it("accepts the right key", () => {
    expect(checkKey("right-key", env)).toEqual({ ok: true });
  });

  it("fails closed when MINER_API_KEY is not set", () => {
    expect(checkKey("anything", { VERCEL_ENV: "production" })).toMatchObject({ ok: false, status: 503 });
    expect(checkKey("anything", {})).toMatchObject({ ok: false, status: 503 });
  });
});

describe("admit", () => {
  it("refuses requests above the per-minute rate", async () => {
    const store = new MemoryStore();
    const limits = { ratePerMinute: 2, maxConcurrentCompute: 4 };
    const now = Date.parse("2026-11-03T12:00:10Z");
    expect(await admit(store, limits, now)).toEqual({ ok: true });
    expect(await admit(store, limits, now)).toEqual({ ok: true });
    expect(await admit(store, limits, now)).toMatchObject({ ok: false });
    expect(await admit(store, limits, now + 60_000)).toEqual({ ok: true });
  });
});

describe("enterCompute", () => {
  it("caps concurrent first-time computations and frees the slot on leave", async () => {
    const store = new MemoryStore();
    const limits = { ratePerMinute: 100, maxConcurrentCompute: 1 };
    const first = await enterCompute(store, limits, 25);
    expect(first).toEqual({ ok: true, slot: 0 });
    expect(await enterCompute(store, limits, 25)).toMatchObject({ ok: false });
    if (first.ok) await leaveCompute(store, first.slot);
    expect(await enterCompute(store, limits, 25)).toEqual({ ok: true, slot: 0 });
  });

  it("frees a slot left by a killed instance after its TTL, even under steady traffic", async () => {
    let clock = 0;
    const store = new MemoryStore(() => clock);
    const limits = { ratePerMinute: 100, maxConcurrentCompute: 1 };
    expect(await enterCompute(store, limits, 25)).toMatchObject({ ok: true });
    for (clock = 1_000; clock < 25_000; clock += 5_000) {
      expect(await enterCompute(store, limits, 25)).toMatchObject({ ok: false });
    }
    clock = 25_001;
    expect(await enterCompute(store, limits, 25)).toMatchObject({ ok: true });
  });
});

describe("admitLimitsFromEnv", () => {
  it("treats empty values as the defaults and rejects invalid ones", () => {
    expect(admitLimitsFromEnv({ ORIGIN_RATE_PER_MIN: "", MAX_CONCURRENT_COMPUTE: "" })).toEqual({
      ratePerMinute: 120,
      maxConcurrentCompute: 4,
    });
    expect(() => admitLimitsFromEnv({ ORIGIN_RATE_PER_MIN: "120/min" })).toThrow();
  });
});
