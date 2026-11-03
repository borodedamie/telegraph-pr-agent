import { describe, expect, it } from "vitest";
import { admit, checkKey, enterCompute, leaveCompute } from "../../src/auth.js";
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
    expect(await enterCompute(store, limits)).toEqual({ ok: true });
    expect(await enterCompute(store, limits)).toMatchObject({ ok: false });
    await leaveCompute(store);
    expect(await enterCompute(store, limits)).toEqual({ ok: true });
  });
});
