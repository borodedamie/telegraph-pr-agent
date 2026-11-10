import { describe, expect, it } from "vitest";
import { answerQuestion, type PipelineDeps } from "../../src/answer.js";
import { limitsFromEnv } from "../../src/budget.js";
import { MemoryStore } from "../../src/cache.js";
import { ModelFailure, type ModelCaller } from "../../src/extract/model.js";
import { GOT_MULTI, fixtureFetcher } from "../fixtures.js";

const QUESTION = "What changed in got from 8.0.2 to 11.0.0?";
const COMPARE = "https://api.github.com/repos/sindresorhus/got/compare/v8.0.2...v8.0.3";

/** Answers every call with nothing found, and counts the calls and the sections each one carried. */
function emptyModel(): { caller: ModelCaller; sectionsPerCall: number[] } {
  const sectionsPerCall: number[] = [];
  const caller: ModelCaller = async (_miner, prompt) => {
    sectionsPerCall.push((prompt.match(/<section id=/g) ?? []).length);
    return { text: JSON.stringify({ items: [] }), costMicroUsdc: 10_000 };
  };
  return { caller, sectionsPerCall };
}

function deps(files: Record<string, string>, caller: ModelCaller | null, limits: Record<string, string> = {}): PipelineDeps {
  return { store: new MemoryStore(), env: { LLM_MINERS: "302:POST:/gen" }, fetcher: fixtureFetcher(files).fetcher, caller, limits: limitsFromEnv(limits) };
}

describe("US3: got 8.0.2 → 11.0.0, 40 releases over three majors", () => {
  it("states each change's version, within the range", async () => {
    const { answer } = await answerQuestion(QUESTION, deps(GOT_MULTI, null));
    expect(answer.outcome).toBe("found");
    const coverage = answer.coverage!;
    expect(coverage.covered.length + coverage.notCovered.length).toBe(40);
    const majors = new Set(answer.changes.map((c) => c.version.split(".")[0]));
    expect([...majors].sort()).toEqual(["10", "11", "9"]);
    for (const item of answer.changes) {
      expect(answer.answer).toContain(`(${item.version}).`);
    }
  });

  it("names the release that has no material and marks the coverage partial", async () => {
    const withoutCompare = Object.fromEntries(Object.entries(GOT_MULTI).filter(([url]) => url !== COMPARE));
    const { answer } = await answerQuestion(QUESTION, deps(withoutCompare, null));
    expect(answer.coverage).toMatchObject({ complete: false, notCovered: [{ version: "8.0.3", reason: "no_material" }] });
    expect(answer.answer).toContain("Coverage partial: 39 of 40 releases covered; not covered 8.0.3 (no material).");
  });

  it("covers that release from its tag compare when the compare can be read", async () => {
    const { answer } = await answerQuestion(QUESTION, deps(GOT_MULTI, null));
    expect(answer.coverage!.covered).toContain("8.0.3");
  });

  it("stays within MAX_MODEL_CALLS and names, grouped, every release the model budget cut", async () => {
    const model = emptyModel();
    const { answer } = await answerQuestion(
      QUESTION,
      deps(GOT_MULTI, model.caller, { MAX_MODEL_CALLS: "2", MAX_MODEL_COST_USDC: "0.02", MAX_MODEL_RELEASES: "30" })
    );
    expect(model.sectionsPerCall).toHaveLength(2);
    expect(model.sectionsPerCall.reduce((a, b) => a + b, 0)).toBe(30);

    const coverage = answer.coverage!;
    expect(coverage.notCovered.filter((n) => n.reason === "budget")).toHaveLength(10);
    expect(coverage.covered).toHaveLength(30);
    const line = answer.answer.split("\n").find((l) => l.startsWith("Coverage partial"))!;
    expect(line).toMatch(/–[\d.]+ \(budget, \d+ releases\)/);
    expect(line).not.toContain(" more.");
  });

  it("reads all 40 releases in two calls where one call reads 16", async () => {
    const one = emptyModel();
    const first = await answerQuestion(QUESTION, deps(GOT_MULTI, one.caller));
    expect(one.sectionsPerCall).toEqual([16]);
    expect(first.answer.coverage!.covered).toHaveLength(16);

    const two = emptyModel();
    const second = await answerQuestion(QUESTION, deps(GOT_MULTI, two.caller, { MAX_MODEL_CALLS: "2", MAX_MODEL_COST_USDC: "0.02", MAX_MODEL_RELEASES: "40" }));
    expect(two.sectionsPerCall).toEqual([16, 24]);
    expect(second.answer.coverage).toMatchObject({ complete: true });
  });

  it("names the releases of a failed call as unavailable and asks again after the partial-answer hour", async () => {
    let clock = 0;
    let calls = 0;
    // The second of the two calls fails every time.
    const caller: ModelCaller = async (_miner, prompt) => {
      calls++;
      if ((prompt.match(/<section id=/g) ?? []).length === 24) throw new ModelFailure("invalid_reply", "miner 302: HTTP 500", 10_000);
      return { text: JSON.stringify({ items: [] }), costMicroUsdc: 10_000 };
    };
    const store = new MemoryStore(() => clock);
    const ask = () =>
      answerQuestion(QUESTION, {
        ...deps(GOT_MULTI, caller, { MAX_MODEL_CALLS: "2", MAX_MODEL_COST_USDC: "0.02", MAX_MODEL_RELEASES: "40" }),
        store,
        now: () => clock,
      });
    const { answer } = await ask();
    expect(answer.coverage!.notCovered.filter((n) => n.reason === "upstream_unavailable")).toHaveLength(24);
    expect(answer.answer).toMatch(/\(upstream unavailable, \d+ releases\)/);
    expect(calls).toBe(2);
    clock = 3_600_000;
    await ask();
    expect(calls).toBe(4);
  });
});
