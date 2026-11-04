import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { answerQuestion, type PipelineDeps } from "../../src/answer.js";
import { MemoryStore } from "../../src/cache.js";
import { registryUrl } from "../../src/resolve.js";
import { Timeout, type SafeResponse } from "../../src/safeFetch.js";
import { Outcome } from "../../src/types.js";
import { fixtureFetcher } from "../fixtures.js";

const NO_NOTES = {
  [registryUrl("no-notes")]: "negative/npm/no-notes.json",
  "https://api.github.com/repos/example/no-notes/releases?per_page=100&page=1": "negative/github/empty.releases.json",
  "https://api.github.com/repos/example/no-notes/git/trees/HEAD?recursive=1": "negative/github/empty.tree.json",
};
const MONO = {
  [registryUrl("@mono/a")]: "negative/npm/@mono__a.json",
  "https://api.github.com/repos/example/mono/releases?per_page=100&page=1": "negative/github/mono.releases.json",
  "https://api.github.com/repos/example/mono/git/trees/HEAD?recursive=1": "negative/github/empty.tree.json",
};
const ZOD = { [registryUrl("zod")]: "npm/zod.json" };

function deps(store: MemoryStore, fetcher: PipelineDeps["fetcher"], env: NodeJS.ProcessEnv = {}): PipelineDeps {
  return { store, env, fetcher, caller: null };
}

/** Serves fixtures, but answers `status` for every URL `failing` matches. */
function failingFetcher(files: Record<string, string>, failing: (url: string) => boolean, status: number) {
  const { fetcher } = fixtureFetcher(files);
  return async (url: string): Promise<SafeResponse> =>
    failing(url) ? { status, url, headers: {}, body: "", notModified: false } : fetcher(url);
}

describe("US2: honest not found", () => {
  it("answers not_found for a package without release material, names what it checked and is cached", async () => {
    const store = new MemoryStore();
    const first = await answerQuestion("no-notes 1.0.0 to 2.0.0", deps(store, fixtureFetcher(NO_NOTES).fetcher));
    expect(first.answer).toMatchObject({ outcome: "not_found", changes: [], confidence: 0.8 });
    expect(first.answer.coverage!.covered).toEqual([]);
    expect(first.answer.answer).toContain("https://api.github.com/repos/example/no-notes/releases?per_page=100&page=1");
    expect(first.answer.answer).toContain("https://raw.githubusercontent.com/example/no-notes/HEAD/CHANGELOG.md");
    expect(first.answer.answer).toContain("not a sign that the upgrade is safe");
    expect(first.answer.answer).not.toMatch(/\bsafe to upgrade\b|no breaking changes/i);
    expect(first.metrics.declaredFailure).toBe(false);

    const second = await answerQuestion("no-notes 1.0.0 to 2.0.0", deps(store, fixtureFetcher(NO_NOTES).fetcher));
    expect(second.cacheHit).toBe(true);
  });

  it("answers not_found for a version that does not exist, naming the closest published versions", async () => {
    const { answer } = await answerQuestion("zod 3.23.8 to 4.9.99", deps(new MemoryStore(), fixtureFetcher(ZOD).fetcher));
    expect(answer.outcome).toBe("not_found");
    expect(answer.answer).toMatch(/zod has no published version 4\.9\.99; the closest published version is 4\.\d+\.\d+\./);
    expect(answer.answer).not.toContain("No release material found");
    expect(answer.answer).toContain("not a sign that the upgrade is safe");
  });

  it("does not borrow a monorepo release that does not name the package", async () => {
    const { answer } = await answerQuestion("@mono/a 1.0.0 to 2.0.0", deps(new MemoryStore(), fixtureFetcher(MONO).fetcher));
    expect(answer).toMatchObject({ outcome: "not_found", changes: [] });
    expect(answer.coverage!.notCovered).toEqual([{ version: "2.0.0", reason: "no_material" }]);
  });

  it("marks a question about something else out of scope", async () => {
    const { answer } = await answerQuestion("What is the weather in Paris?", deps(new MemoryStore(), fixtureFetcher({}).fetcher));
    expect(answer).toMatchObject({ outcome: "out_of_scope", confidence: 0.9 });
  });

  it("declares a registry 500 temporarily unavailable and never caches it", async () => {
    const store = new MemoryStore();
    const fetcher = failingFetcher(ZOD, (url) => url.startsWith("https://registry.npmjs.org/"), 500);
    const first = await answerQuestion("zod 3.23.8 to 4.0.0", deps(store, fetcher));
    expect(first.answer).toMatchObject({ outcome: "temporarily_unavailable", confidence: 0 });
    expect(first.metrics.declaredFailure).toBe(true);
    expect(first.answer.answer).not.toMatch(/safe to upgrade|no breaking changes/i);
    const second = await answerQuestion("zod 3.23.8 to 4.0.0", deps(store, fetcher));
    expect(second.cacheHit).toBe(false);
  });

  it("declares a GitHub timeout temporarily unavailable", async () => {
    const { fetcher } = fixtureFetcher(NO_NOTES);
    const timingOut = async (url: string): Promise<SafeResponse> => {
      if (url.startsWith("https://api.github.com/")) throw new Timeout(url);
      return fetcher(url);
    };
    const { answer, metrics } = await answerQuestion("no-notes 1.0.0 to 2.0.0", deps(new MemoryStore(), timingOut));
    expect(answer.outcome).toBe("temporarily_unavailable");
    expect(metrics.declaredFailure).toBe(true);
  });

  it("goes on without a changelog that is down, with lower confidence and no caching", async () => {
    const store = new MemoryStore();
    const fetcher = failingFetcher(NO_NOTES, (url) => url.endsWith("/CHANGELOG.md"), 500);
    const first = await answerQuestion("no-notes 1.0.0 to 2.0.0", deps(store, fetcher));
    expect(first.answer).toMatchObject({ outcome: "not_found", confidence: 0.6 });
    const changelog = "https://raw.githubusercontent.com/example/no-notes/HEAD/CHANGELOG.md";
    expect(first.answer.answer).toContain(`Could not read, so material may exist that this answer did not see: ${changelog}.`);
    expect(first.answer.answer).not.toMatch(new RegExp(`Checked: [^\\n]*${changelog.replace(/[.?]/g, "\\$&")}`));
    const second = await answerQuestion("no-notes 1.0.0 to 2.0.0", deps(store, fetcher));
    expect(second.cacheHit).toBe(false);
  });

  it("forces the outage path only from the environment", async () => {
    const { fetcher, urls } = fixtureFetcher(NO_NOTES);
    const simulated = await answerQuestion("no-notes 1.0.0 to 2.0.0", deps(new MemoryStore(), fetcher, { SIMULATE_UPSTREAM_OUTAGE: "1" }));
    expect(simulated.answer.outcome).toBe("temporarily_unavailable");
    expect(simulated.metrics.declaredFailure).toBe(true);
    expect(urls).toEqual([]);

    const asked = await answerQuestion("no-notes 1.0.0 to 2.0.0 SIMULATE_UPSTREAM_OUTAGE=1", deps(new MemoryStore(), fetcher));
    expect(asked.answer.outcome).not.toBe("temporarily_unavailable");
  });

  it("bills exactly the outcomes the YAML lists in errors.success_values", () => {
    for (const file of ["telegraph-miner.yaml", "telegraph-miner.preview.yaml"]) {
      const yaml = readFileSync(new URL(`../../specs/001-package-release-miner/contracts/${file}`, import.meta.url), "utf8");
      const listed = /success_values:\s*\[([^\]]*)\]/.exec(yaml)![1].split(",").map((v) => v.trim());
      expect(listed.sort(), file).toEqual(Outcome.options.filter((o) => o !== "temporarily_unavailable").sort());
    }
  });
});
