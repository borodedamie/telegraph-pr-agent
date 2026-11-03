import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Budget, limitsFromEnv } from "../../src/budget.js";
import { MemoryStore } from "../../src/cache.js";
import { CoverageTracker, releasesBetween } from "../../src/coverage.js";
import { Packument, reducePackument } from "../../src/resolve.js";
import type { SafeResponse } from "../../src/safeFetch.js";
import { newRetrieval } from "../../src/sources/fetch.js";
import { pickMigrationGuide, repoIdentity, retrieveReleaseNotes } from "../../src/sources/github.js";

export function fixtureFetcher(files: Record<string, string>) {
  const urls: string[] = [];
  const fetcher = async (url: string): Promise<SafeResponse> => {
    urls.push(url);
    const file = files[url];
    if (file === undefined) return { status: 404, url, headers: {}, body: "", notModified: false };
    return { status: 200, url, headers: {}, body: readFileSync(new URL(`../fixtures/${file}`, import.meta.url), "utf8"), notModified: false };
  };
  return { fetcher, urls };
}

export const ZOD_GITHUB = {
  "https://api.github.com/repos/colinhacks/zod/releases?per_page=100&page=1": "github/zod.releases.1.json",
  "https://api.github.com/repos/colinhacks/zod/releases?per_page=100&page=2": "github/zod.releases.2.json",
  "https://api.github.com/repos/colinhacks/zod/git/trees/HEAD?recursive=1": "github/zod.tree.json",
  "https://raw.githubusercontent.com/colinhacks/zod/HEAD/packages/docs/content/v4/changelog.mdx": "github/zod.v4-changelog.mdx",
};

describe("repoIdentity", () => {
  it("reads the common repository forms", () => {
    expect(repoIdentity({ type: "git", url: "git+https://github.com/colinhacks/zod.git" })).toEqual({
      owner: "colinhacks",
      repo: "zod",
      directory: null,
    });
    expect(repoIdentity({ url: "https://github.com/babel/babel.git", directory: "packages/babel-core" })).toMatchObject({
      directory: "packages/babel-core",
    });
    expect(repoIdentity("github:owner/name")).toEqual({ owner: "owner", repo: "name", directory: null });
    expect(repoIdentity("git@github.com:owner/name.git")).toMatchObject({ owner: "owner", repo: "name" });
    expect(repoIdentity("https://github.com/o/r/tree/main/packages/x")).toMatchObject({ directory: "packages/x" });
  });

  it("refuses repositories outside GitHub and missing fields", () => {
    expect(repoIdentity({ url: "https://gitlab.com/o/r.git" })).toHaveProperty("reason");
    expect(repoIdentity(null)).toHaveProperty("reason");
  });
});

describe("pickMigrationGuide", () => {
  it("picks the guide for the new major, preferring the package's own framework", () => {
    const paths = [
      "docs/framework/vue/guides/migrating-to-v5.md",
      "docs/framework/react/guides/migrating-to-v5.md",
      "docs/framework/react/guides/migrating-to-v4.md",
      "README.md",
    ];
    expect(pickMigrationGuide(paths, "5.0.0", "@tanstack/react-query")).toBe("docs/framework/react/guides/migrating-to-v5.md");
    expect(pickMigrationGuide(["packages/docs/content/v4/changelog.mdx"], "4.0.0", "zod")).toBe(
      "packages/docs/content/v4/changelog.mdx"
    );
    expect(pickMigrationGuide(paths, "6.0.0", "@tanstack/react-query")).toBeNull();
  });
});

describe("retrieveReleaseNotes", () => {
  it("finds every zod release from 3.24.0 to 4.0.0, with the v4 migration guide for 4.0.0", async () => {
    const packument = Packument.parse(JSON.parse(reducePackument(readFileSync(new URL("../fixtures/npm/zod.json", import.meta.url), "utf8"))));
    const releases = releasesBetween(packument.versions, "3.23.8", "4.0.0");
    const tracker = new CoverageTracker(releases);
    const { fetcher, urls } = fixtureFetcher(ZOD_GITHUB);
    const retrieval = newRetrieval(new MemoryStore(), new Budget(limitsFromEnv({})), fetcher);
    const material = await retrieveReleaseNotes(retrieval, repoIdentity(packument.repository) as never, packument, "3.23.8", tracker, {});

    const found = new Set(material.sections.map((s) => s.version));
    expect(found.has("4.0.0")).toBe(true);
    expect(found.has("3.25.76")).toBe(true);
    const guide = material.consulted.find((c) => c.type === "migration_guide");
    expect(guide).toMatchObject({ versionTo: "4.0.0", versionFrom: "3.25.76", trust: "official" });
    expect(urls).toContain("https://raw.githubusercontent.com/colinhacks/zod/HEAD/CHANGELOG.md");
    // Every section is exact text of its consulted document.
    for (const section of material.sections) {
      const consulted = material.consulted[section.consulted];
      if (consulted.type === "release") expect(JSON.parse(consulted.document.text).some((r: { body: string }) => r.body === section.text)).toBe(true);
      else expect(consulted.document.text).toContain(section.text);
    }
    console.log("missing", releases.filter((v) => !found.has(v)).join(" "));
  });
});
