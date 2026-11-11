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
