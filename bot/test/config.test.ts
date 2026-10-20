import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnv = {
  CHAIN_ID: "84532",
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
    expect(cfg.chainId).toBe(84532);
    expect(cfg.usdcAddress).toBe(validEnv.USDC_ADDRESS);
    expect(cfg.nodeUrl).toBe(validEnv.NODE_URL);
    expect(cfg.modelCutoff.getTime()).toBe(Date.parse(validEnv.MODEL_CUTOFF));
    expect(cfg.budgetCapUsdc).toBeCloseTo(0.5);
    expect(cfg.maxPricePerCallUsdc).toBeCloseTo(0.05);
    expect(cfg.demoRepo).toBe("owner/repo");
  });

  it("fails fast naming the missing field", () => {
    const env: NodeJS.ProcessEnv = { ...validEnv };
    delete env.CHAIN_ID;
    expect(() => loadConfig(env)).toThrow(/CHAIN_ID/);
  });

  it("fails fast naming the invalid field", () => {
    expect(() => loadConfig({ ...validEnv, BUDGET_CAP_USDC: "abc" })).toThrow(/BUDGET_CAP_USDC/);
  });

  it("rejects a non-ISO modelCutoff", () => {
    expect(() => loadConfig({ ...validEnv, MODEL_CUTOFF: "last tuesday" })).toThrow(/MODEL_CUTOFF/);
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
