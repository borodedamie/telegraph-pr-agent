import { describe, expect, it } from "vitest";
import { Budget, limitsFromEnv } from "../../src/budget.js";

describe("Budget", () => {
  it("stops source requests at the limit and reports it", () => {
    const budget = new Budget({ ...limitsFromEnv({}), maxSourceRequests: 2 });
    expect(budget.takeSourceRequest()).toBe(true);
    expect(budget.takeSourceRequest()).toBe(true);
    expect(budget.takeSourceRequest()).toBe(false);
    expect(budget.exhausted()).toBe("source_requests");
    budget.dispose();
  });

  it("allows one model call per answer by default and refuses a second", () => {
    const budget = new Budget(limitsFromEnv({}));
    expect(budget.canCallModel(10_000, 10_000, 1)).toBe(true);
    budget.recordModelCall(10_000, 10_000, 1);
    expect(budget.canCallModel(10_000, 10_000, 1)).toBe(false);
    expect(budget.exhausted()).toBe("model_calls");
    budget.dispose();
  });

  it("refuses a model call that would not finish before the deadline", () => {
    let clock = 0;
    const budget = new Budget(limitsFromEnv({}), () => clock);
    clock = 10_000; // 10 s left of 20 s, less than the 12 s LLM timeout
    expect(budget.canCallModel(1_000, 10_000, 1)).toBe(false);
    expect(budget.exhausted()).toBe("model_time");
    budget.dispose();
  });

  it("refuses a quote above the per-request cost cap", () => {
    const budget = new Budget(limitsFromEnv({}));
    expect(budget.canCallModel(1_000, 15_000, 1)).toBe(false);
    expect(budget.exhausted()).toBe("model_cost");
    budget.dispose();
  });

  it("aborts its signal at the time budget", async () => {
    const budget = new Budget({ ...limitsFromEnv({}), maxTimeMs: 10 });
    await new Promise((r) => setTimeout(r, 30));
    expect(budget.signal.aborted).toBe(true);
    expect(budget.exhausted()).toBe("time");
    budget.dispose();
  });

  it("rejects invalid env values instead of ignoring them", () => {
    expect(() => limitsFromEnv({ MAX_TIME_MS: "soon" })).toThrow(/MAX_TIME_MS/);
  });
});
