import { describe, expect, it } from "vitest";
import { answerQuestion, type PipelineDeps } from "../../src/answer.js";
import { limitsFromEnv } from "../../src/budget.js";
import { MemoryStore, getSnapshot } from "../../src/cache.js";
import type { ModelCaller } from "../../src/extract/model.js";
import { findSpan } from "../../src/extract/verify.js";
import { registryUrl } from "../../src/resolve.js";
import { TooLarge } from "../../src/safeFetch.js";
import { ZOD_GITHUB, fixtureFetcher } from "../fixtures.js";

const FILES: Record<string, string> = { [registryUrl("zod")]: "npm/zod.json", ...ZOD_GITHUB };

/** Answers like an LLM miner: one real item quoted from the first section, with a step the source does not state. */
function stubModel(): { caller: ModelCaller; calls: () => number; excerpt: () => string | null } {
  let calls = 0;
  let excerpt: string | null = null;
  const caller: ModelCaller = async (_miner, prompt) => {
    calls++;
    const first = /<section id="(x\d+)">\n([\s\S]*?)\n<\/section>/.exec(prompt);
    const line = first?.[2].split("\n").find((l) => /^[A-Za-z][^`*_|]{20,}$/.test(l.trim()));
    excerpt = line?.trim() ?? null;
    const items = first && excerpt
      ? [{
          id: "i1", sectionId: first[1], kind: "breaking", change: "Stub change",
          excerpt, migration: "Upgrade every project to TypeScript 5.5",
          migrationExcerpt: "Upgrade every project to TypeScript 5.5",
        }]
      : [];
    return { text: JSON.stringify({ items }), costMicroUsdc: 10_000 };
  };
  return { caller, calls: () => calls, excerpt: () => excerpt };
}

function deps(store: MemoryStore, caller: ModelCaller | null): PipelineDeps {
  return { store, env: { LLM_MINERS: "302:POST:/gen" }, fetcher: fixtureFetcher(FILES).fetcher, caller };
}

const QUESTION = "What changed in zod from 3.23.8 to 4.0.0?";

describe("US1: zod 3.23.8 → 4.0.0", () => {
  it("considers every release between A and B and verifies every excerpt", async () => {
    const store = new MemoryStore();
    const { answer } = await answerQuestion(QUESTION, deps(store, stubModel().caller));
    expect(answer.outcome).toBe("found");
    expect(answer.request).toMatchObject({ fromResolved: "3.23.8", toResolved: "4.0.0", fromAssumed: false });
    expect(answer.targetReleasedAt).toBe("2025-07-09T18:47:37.886Z");

    const coverage = answer.coverage!;
    const listed = [...coverage.covered, ...coverage.notCovered.map((n) => n.version)];
    expect(listed).toContain("3.24.0");
    expect(listed).toContain("3.25.76");
    expect(listed).toContain("4.0.0");
    expect(new Set(listed).size).toBe(listed.length);
    expect(coverage.covered).toContain("4.0.0");

    const documented = answer.changes.filter((c) => c.evidenceType === "documented");
    expect(documented.length).toBeGreaterThan(10);
    for (const item of documented) {
      const source = answer.sources.find((s) => s.id === item.sourceId)!;
      const snapshot = (await getSnapshot(store, source.snapshotKey))!;
      const text = source.type === "release" ? JSON.parse(snapshot).map((r: { body: string }) => r.body).join("\n") : snapshot;
      expect(findSpan(text, item.excerpt!)).toBe(item.excerpt);
    }
    expect(answer.answer).toMatch(/^zod 3\.23\.8 → 4\.0\.0 \(released 2025-07-09\)/);
  });

  it("shows a model step the source does not state as not documented", async () => {
    const model = stubModel();
    const { answer } = await answerQuestion(QUESTION, deps(new MemoryStore(), model.caller));
    expect(model.excerpt()).not.toBeNull();
    const item = answer.changes.find((c) => c.change === "Stub change");
    expect(item).toMatchObject({ evidenceType: "documented", excerpt: model.excerpt() });
    expect(item!.migrationEvidence).not.toBe("documented");
  });

  it("says when the from version was assumed", async () => {
    const { answer } = await answerQuestion("What breaks if I upgrade zod to 4.0.0?", deps(new MemoryStore(), stubModel().caller));
    expect(answer.request).toMatchObject({ fromResolved: "3.25.76", fromAssumed: true });
    expect(answer.answer).toContain("(from version assumed: 3.25.76");
  });

  it("returns the identical string on a repeat call without calling the model", async () => {
    const store = new MemoryStore();
    const model = stubModel();
    // A model budget that fits every section, so the answer is complete and cached.
    const roomy = { ...deps(store, model.caller), limits: limitsFromEnv({ MAX_MODEL_RELEASES: "100", MAX_MODEL_INPUT_CHARS: "500000" }) };
    const first = await answerQuestion(QUESTION, roomy);
    const second = await answerQuestion(QUESTION, roomy);
    expect(second.cacheHit).toBe(true);
    expect(second.json).toBe(first.json);
    expect(model.calls()).toBe(1);
  });

  it("never serves a rules-only answer for a full one", async () => {
    const store = new MemoryStore();
    const rulesOnly = await answerQuestion(QUESTION, deps(store, null));
    expect(rulesOnly.metrics.extractorMode).toBe("rules_only");
    expect(rulesOnly.answer.processingVersion).toContain("rules_only");
    expect(rulesOnly.answer.answer).toContain("Notice: the model pass did not run");
    expect(rulesOnly.answer.confidence).toBeLessThanOrEqual(0.5);
    const model = stubModel();
    const full = await answerQuestion(QUESTION, deps(store, model.caller));
    expect(full.cacheHit).toBe(false);
    expect(model.calls()).toBe(1);
    expect(full.answer.processingVersion).toContain("rules_and_model");
  });

  it("marks releases the model could not fit as not covered and caches that honest answer", async () => {
    const store = new MemoryStore();
    const model = stubModel();
    const small = { ...deps(store, model.caller), limits: limitsFromEnv({ MAX_MODEL_RELEASES: "1" }) };
    const first = await answerQuestion(QUESTION, small);
    expect(first.answer.processingVersion).toContain("rules_and_model");
    const budgetCut = first.answer.coverage!.notCovered.filter((n) => n.reason === "budget").map((n) => n.version);
    expect(first.answer.coverage!.covered.some((v) => budgetCut.includes(v))).toBe(false);
    expect(budgetCut.length).toBeGreaterThan(0);
    const second = await answerQuestion(QUESTION, small);
    expect(second.cacheHit).toBe(true);
    expect(model.calls()).toBe(1);
  });

  it("does not count releases as covered when a later fetch of the same step fails", async () => {
    const { fetcher } = fixtureFetcher(FILES);
    const page2 = "https://api.github.com/repos/colinhacks/zod/releases?per_page=100&page=2";
    const failing: typeof fetcher = async (url) =>
      url === page2 ? { status: 502, url, headers: {}, body: "", notModified: false } : fetcher(url);
    const { answer } = await answerQuestion(QUESTION, { ...deps(new MemoryStore(), stubModel().caller), fetcher: failing });
    expect(answer.outcome).toBe("temporarily_unavailable");
    expect(answer.changes).toEqual([]);
  });

  it("does not answer not_found when the budget ran out before any release was read", async () => {
    const store = new MemoryStore();
    const tight = { ...deps(store, stubModel().caller), limits: limitsFromEnv({ MAX_SOURCE_REQUESTS: "1" }) };
    const { answer } = await answerQuestion(QUESTION, tight);
    expect(answer.outcome).toBe("temporarily_unavailable");
  });

  it("answers instead of failing when a source is over its size cap", async () => {
    const { fetcher } = fixtureFetcher(FILES);
    const guide = "https://raw.githubusercontent.com/colinhacks/zod/HEAD/packages/docs/content/v4/changelog.mdx";
    const page1 = "https://api.github.com/repos/colinhacks/zod/releases?per_page=100&page=1";
    const capped: typeof fetcher = async (url) => {
      if (url === guide || url === page1) throw new TooLarge(url, 2 * 1024 * 1024);
      return fetcher(url);
    };
    const { answer } = await answerQuestion(QUESTION, { ...deps(new MemoryStore(), stubModel().caller), fetcher: capped });
    expect(answer.outcome).not.toBe("temporarily_unavailable");
    expect(answer.coverage!.notCovered.some((n) => n.reason === "truncated")).toBe(true);
    expect(answer).toMatchObject({ outcome: "not_found", confidence: 0.6 });
  });

  it("keeps the release notes already read when the source budget runs out on a later fetch", async () => {
    // Registry and releases page 1 fit; page 2 does not.
    const tight = { ...deps(new MemoryStore(), stubModel().caller), limits: limitsFromEnv({ MAX_SOURCE_REQUESTS: "2" }) };
    const { answer } = await answerQuestion(QUESTION, tight);
    expect(answer.outcome).toBe("found");
    expect(answer.coverage!.covered.length).toBeGreaterThan(0);
    expect(answer.coverage!.notCovered.every((n) => n.reason === "budget")).toBe(true);
  });
});
