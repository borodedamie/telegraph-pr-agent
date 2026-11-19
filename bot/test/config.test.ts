import { expect, it } from "vitest";
import { readModelProvenance } from "../src/config.js";

it("records explicit cutoff provenance and rejects incomplete or credentialed sources", () => {
  const env = { MODEL_PROVIDER: "test-provider", MODEL_ID: "test-model", MODEL_CUTOFF_SOURCE_URL: "https://example.org/source",
    MODEL_CUTOFF_STATUS: "team-assumed", MODEL_CONFIGURED_AT: "2026-11-08T00:00:00.000Z" };
  expect(readModelProvenance(env, new Date("2025-01-01"))).toEqual({ provider: "test-provider", model: "test-model",
    cutoff: "2025-01-01T00:00:00.000Z", sourceUrl: env.MODEL_CUTOFF_SOURCE_URL, status: "team-assumed", configuredAt: env.MODEL_CONFIGURED_AT });
  expect(() => readModelProvenance({}, new Date("2025-01-01"))).toThrow();
  expect(() => readModelProvenance({ ...env, MODEL_CUTOFF_SOURCE_URL: "https://user:pass@example.org" }, new Date("2025-01-01"))).toThrow();
});

const base = { MODEL_CUTOFF_SOURCE_URL: "https://example.org/why-this-date", MODEL_CUTOFF_STATUS: "team-assumed",
  MODEL_CONFIGURED_AT: "2026-11-20T00:00:00.000Z" };
const cutoff = new Date("2026-01-01");

it("accepts a team-assumed cutoff with no coding model named, and records no model", () => {
  for (const blank of [{}, { MODEL_PROVIDER: "", MODEL_ID: "" }, { MODEL_PROVIDER: "  ", MODEL_ID: " " }]) {
    expect(readModelProvenance({ ...base, ...blank }, cutoff)).toEqual({ cutoff: "2026-01-01T00:00:00.000Z",
      sourceUrl: base.MODEL_CUTOFF_SOURCE_URL, status: "team-assumed", configuredAt: base.MODEL_CONFIGURED_AT });
  }
});

it("needs a named coding model for a provider-documented cutoff", () => {
  expect(() => readModelProvenance({ ...base, MODEL_CUTOFF_STATUS: "provider-documented" }, cutoff))
    .toThrow(/provider-documented cutoff needs MODEL_PROVIDER and MODEL_ID/);
  expect(readModelProvenance({ ...base, MODEL_CUTOFF_STATUS: "provider-documented", MODEL_PROVIDER: "anthropic",
    MODEL_ID: "claude-sonnet-5" }, cutoff)).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5", status: "provider-documented" });
});

it("requires the provider and model together", () => {
  expect(() => readModelProvenance({ ...base, MODEL_PROVIDER: "anthropic" }, cutoff)).toThrow(/together/);
  expect(() => readModelProvenance({ ...base, MODEL_ID: "claude-sonnet-5" }, cutoff)).toThrow(/together/);
});

it("never names Telegraph or a miner as the coding model", () => {
  expect(() => readModelProvenance({ ...base, MODEL_PROVIDER: "Telegraph", MODEL_ID: "claude-sonnet-5" }, cutoff))
    .toThrow(/never Telegraph/);
  expect(() => readModelProvenance({ ...base, MODEL_PROVIDER: "anthropic", MODEL_ID: "7314" }, cutoff))
    .toThrow(/never a Telegraph miner id/);
});
