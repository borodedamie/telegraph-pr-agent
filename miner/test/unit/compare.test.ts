import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Budget, limitsFromEnv } from "../../src/budget.js";
import { MemoryStore } from "../../src/cache.js";
import { CoverageTracker } from "../../src/coverage.js";
import type { SafeResponse } from "../../src/safeFetch.js";
import { missingRuns, reduceCompare, retrieveComparisons } from "../../src/sources/compare.js";
import { newRetrieval } from "../../src/sources/fetch.js";

const zodCompare = readFileSync(new URL("../fixtures/github/zod.compare.v3.25.75...v3.25.76.json", import.meta.url), "utf8");

function compareBody(files: Array<{ filename: string; patch?: string }>, commits = 1, totalCommits = commits): string {
  return JSON.stringify({
    total_commits: totalCommits,
    commits: Array.from({ length: commits }, (_, i) => ({ sha: String(i), commit: { message: "feat!: remove everything" } })),
    files,
  });
}

function fetcherFor(body: string) {
  const urls: string[] = [];
  const fetcher = async (url: string): Promise<SafeResponse> => {
    urls.push(url);
    return { status: 200, url, headers: {}, body, notModified: false };
  };
  return { fetcher, urls };
}

async function run(body: string, directory: string | null, releases = ["1.0.1"]) {
  const tracker = new CoverageTracker(releases);
  const { fetcher, urls } = fetcherFor(body);
  const retrieval = newRetrieval(new MemoryStore(), new Budget(limitsFromEnv({})), fetcher);
  const material = await retrieveComparisons(retrieval, { owner: "o", repo: "r", directory }, "1.0.0", tracker, (v) => `v${v}`, {});
  return { material, tracker, urls };
}

describe("reduceCompare", () => {
  it("keeps only patches under the package directory, outside tests, declarations first", () => {
    const reduced = JSON.parse(reduceCompare(zodCompare, "packages/zod"));
    const names = reduced.files.map((f: { filename: string }) => f.filename);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n: string) => n.startsWith("packages/zod/") && !n.includes("/tests/"))).toBe(true);
    expect(names[0]).toBe("packages/zod/package.json");
    expect(reduced.truncated).toBe(false);
  });

  it("never keeps commit messages", () => {
    const reduced = reduceCompare(compareBody([{ filename: "src/index.ts", patch: "+export const a = 1;" }]), null);
    expect(reduced).not.toContain("remove everything");
  });
});

describe("retrieveComparisons", () => {
  it("compares each run of missing releases once, from the release before it", async () => {
    expect(missingRuns(["1.0.1", "1.0.2", "1.0.3", "1.0.4"], new Set(["1.0.1", "1.0.2", "1.0.4"]))).toEqual([
      ["1.0.1", "1.0.2"],
      ["1.0.4"],
    ]);
    const { material, tracker, urls } = await run(
      compareBody([{ filename: "pkg/index.d.ts", patch: "-export function old(): void;" }]),
      "pkg",
      ["1.0.1", "1.0.2"]
    );
    expect(urls).toEqual(["https://api.github.com/repos/o/r/compare/v1.0.0...v1.0.2"]);
    expect(material.consulted[0]).toMatchObject({ type: "tag_compare", trust: "repository_evidence", versionFrom: "1.0.0", versionTo: "1.0.2" });
    expect(material.sections[0]).toMatchObject({ version: "1.0.2" });
    expect(material.sections[0].text).toContain("-export function old(): void;");
    expect(tracker.result().complete).toBe(true);
  });

  it("produces no section from commit messages alone", async () => {
    const { material } = await run(compareBody([{ filename: "other/x.ts", patch: "+x" }]), "pkg");
    expect(material.sections).toHaveLength(0);
  });

  it("marks releases truncated when GitHub cut the comparison", async () => {
    for (const body of [
      compareBody([{ filename: "a.ts", patch: "+a" }], 250, 400),
      compareBody(Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.ts`, patch: "+x" }))),
      compareBody([{ filename: "big.ts" }]),
    ]) {
      const { tracker } = await run(body, null);
      expect(tracker.result().notCovered).toEqual([{ version: "1.0.1", reason: "truncated" }]);
    }
  });

  it("gives packages that share tags in one repository their own filtered comparison", async () => {
    const store = new MemoryStore();
    const body = compareBody([
      { filename: "packages/a/index.d.ts", patch: "-export a" },
      { filename: "packages/b/index.d.ts", patch: "-export b" },
    ]);
    const forDirectory = async (directory: string) => {
      const retrieval = newRetrieval(store, new Budget(limitsFromEnv({})), fetcherFor(body).fetcher);
      const tracker = new CoverageTracker(["1.0.1"]);
      const material = await retrieveComparisons(retrieval, { owner: "o", repo: "r", directory }, "1.0.0", tracker, (v) => `v${v}`, {});
      return material.sections[0].text;
    };
    expect(await forDirectory("packages/a")).toContain("packages/a/");
    const b = await forDirectory("packages/b");
    expect(b).toContain("packages/b/");
    expect(b).not.toContain("packages/a/");
  });
});
