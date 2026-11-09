import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnv = {
  CHAIN_ID: "11155111",
  USDC_ADDRESS: "0x3129e6d4f5d3e75a3B5eD3D7eF0A1B2C3D4E5F60",
  NODE_URL: "https://devnode.telegraphprotocol.com",
  MODEL_CUTOFF: "2025-01-01T00:00:00Z",
  BUDGET_CAP_USDC: "0.50",
  MAX_PRICE_PER_CALL_USDC: "0.05",
  TELEGRAPH_EVM_PRIVATE_KEY: `0x${"a".repeat(64)}`,
  GH_PAT: "ghp_testtoken",
  LLM_API_KEY: "sk-test",
  LLM_BASE_URL: "https://api.example.com/v1",
  DEMO_REPO: "owner/repo",
};

describe("loadConfig", () => {
  it("parses a complete env into a typed config", () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.chainId).toBe(11155111);
    expect(cfg.usdcAddress).toBe(validEnv.USDC_ADDRESS);
    expect(cfg.nodeUrl).toBe(validEnv.NODE_URL);
    expect(cfg.modelCutoff.getTime()).toBe(Date.parse(validEnv.MODEL_CUTOFF));
    expect(cfg.budgetCapUsdc).toBeCloseTo(0.5);
    expect(cfg.maxPricePerCallUsdc).toBeCloseTo(0.05);
    expect(cfg.demoRepo).toBe("owner/repo");
  });

  it("reads an optional preferred miner id, and treats unset or empty as none", () => {
    expect(loadConfig(validEnv).preferredMinerId).toBeNull();
    expect(loadConfig({ ...validEnv, PREFERRED_MINER_ID: "" }).preferredMinerId).toBeNull();
    expect(loadConfig({ ...validEnv, PREFERRED_MINER_ID: "7314" }).preferredMinerId).toBe("7314");
    expect(() => loadConfig({ ...validEnv, PREFERRED_MINER_ID: "package-release-intel" })).toThrow(/PREFERRED_MINER_ID/);
  });

  it("fails fast naming the missing field", () => {
    const env: NodeJS.ProcessEnv = { ...validEnv };
    delete env.CHAIN_ID;
    expect(() => loadConfig(env)).toThrow(/CHAIN_ID/);
  });

  it("fails fast naming the invalid field", () => {
    expect(() => loadConfig({ ...validEnv, BUDGET_CAP_USDC: "abc" })).toThrow(/BUDGET_CAP_USDC/);
  });

  it("rejects an unparseable modelCutoff", () => {
    expect(() => loadConfig({ ...validEnv, MODEL_CUTOFF: "last tuesday" })).toThrow(/MODEL_CUTOFF/);
  });

  it("accepts a human-readable modelCutoff and pins it to UTC midnight of that date", () => {
    const cfg = loadConfig({ ...validEnv, MODEL_CUTOFF: "January 1, 2026" });
    expect(cfg.modelCutoff.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    const short = loadConfig({ ...validEnv, MODEL_CUTOFF: "1 Jan 2026" });
    expect(short.modelCutoff.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects a malformed private key naming the field", () => {
    expect(() => loadConfig({ ...validEnv, TELEGRAPH_EVM_PRIVATE_KEY: "nothex" })).toThrow(
      /TELEGRAPH_EVM_PRIVATE_KEY/
    );
  });

  it("rejects a malformed DEMO_REPO naming the field", () => {
    expect(() => loadConfig({ ...validEnv, DEMO_REPO: "not-a-repo" })).toThrow(/DEMO_REPO/);
  });
});

it("records explicit cutoff provenance and rejects incomplete or credentialed sources", async () => {
  const { readModelProvenance } = await import("../src/config.js");
  const env = { MODEL_PROVIDER: "test-provider", MODEL_ID: "test-model", MODEL_CUTOFF_SOURCE_URL: "https://example.org/source",
    MODEL_CUTOFF_STATUS: "team-assumed", MODEL_CONFIGURED_AT: "2026-11-08T00:00:00.000Z" };
  expect(readModelProvenance(env, new Date("2025-01-01"))).toEqual({ provider: "test-provider", model: "test-model",
    cutoff: "2025-01-01T00:00:00.000Z", sourceUrl: env.MODEL_CUTOFF_SOURCE_URL, status: "team-assumed", configuredAt: env.MODEL_CONFIGURED_AT });
  expect(() => readModelProvenance({}, new Date("2025-01-01"))).toThrow();
  expect(() => readModelProvenance({ ...env, MODEL_CUTOFF_SOURCE_URL: "https://user:pass@example.org" }, new Date("2025-01-01"))).toThrow();
});
