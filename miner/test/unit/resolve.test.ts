import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Budget, limitsFromEnv } from "../../src/budget.js";
import { MemoryStore } from "../../src/cache.js";
import { Packument, reducePackument, registryUrl, resolve, resolveVersions } from "../../src/resolve.js";
import type { SafeResponse } from "../../src/safeFetch.js";
import { newRetrieval, type SourceDocument } from "../../src/sources/fetch.js";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/npm/${name.replace("/", "__")}.json`, import.meta.url), "utf8");
}

function packument(name: string): { packument: Packument; registry: SourceDocument } {
  const text = reducePackument(fixture(name));
  const registry = { url: registryUrl(name), text, contentHash: "0".repeat(64), snapshotKey: "snap:x", retrievedAt: "2026-11-03T00:00:00.000Z" };
  return { packument: Packument.parse(JSON.parse(text)), registry };
}

function resolveFixture(name: string, fromRequested: string | null, toRequested: string) {
  const { packument: doc, registry } = packument(name);
  return resolveVersions(doc, registry, { package: name, fromRequested, toRequested });
}

describe("resolveVersions", () => {
  it("resolves an exact pair and reports the target date from the registry", () => {
    const result = resolveFixture("zod", "3.23.8", "4.0.0");
    expect(result).toMatchObject({
      kind: "ok",
      request: { fromResolved: "3.23.8", toResolved: "4.0.0", fromAssumed: false },
      targetReleasedAt: "2025-07-09T18:47:37.886Z",
    });
  });

  it("resolves a range to its highest published match", () => {
    expect(resolveFixture("zod", "3.x", "4.0.0")).toMatchObject({ request: { fromResolved: "3.25.76" } });
  });

  it("assumes the highest stable version below the target's major line", () => {
    expect(resolveFixture("zod", null, "4.0.0")).toMatchObject({
      kind: "ok",
      request: { fromResolved: "3.25.76", fromAssumed: true, fromRequested: null },
    });
  });

  it("assumes a version even when the previous major was never published", () => {
    // @angular/forms went from 2.4.x straight to 4.0.0.
    expect(resolveFixture("@angular/forms", null, "4.0.0")).toMatchObject({ request: { fromResolved: "2.4.10" } });
  });

  it("uses the preceding minor line for 0.y targets and asks for 0.0.z", () => {
    expect(resolveFixture("esbuild", null, "0.19.0")).toMatchObject({ request: { fromResolved: "0.18.20" } });
    expect(resolveFixture("esbuild", null, "0.0.13")).toMatchObject({ kind: "needs_clarification" });
  });

  it("asks when no stable version exists below the bound", () => {
    const { registry } = packument("zod");
    const doc: Packument = { name: "fresh", versions: ["1.0.0-rc.1", "1.0.0"], time: {}, "dist-tags": {}, repository: null };
    expect(resolveVersions(doc, registry, { package: "fresh", fromRequested: null, toRequested: "1.0.0" })).toMatchObject({
      kind: "needs_clarification",
    });
  });

  it("resolves a prerelease target", () => {
    expect(resolveFixture("zod", "3.23.8", "4.0.0-beta.1")).toMatchObject({ request: { toResolved: "4.0.0-beta.1" } });
  });

  it("reports an unpublished version instead of picking a near one", () => {
    expect(resolveFixture("zod", "3.23.8", "4.0.99")).toMatchObject({ kind: "version_missing" });
    expect(resolveFixture("zod", "4.0.0", "3.23.8")).toMatchObject({ kind: "needs_clarification" });
  });
});

describe("resolve", () => {
  function registryFetcher(bodies: Record<string, string>) {
    const urls: string[] = [];
    const fetcher = async (url: string): Promise<SafeResponse> => {
      urls.push(url);
      const body = bodies[url];
      return body === undefined
        ? { status: 404, url, headers: {}, body: "", notModified: false }
        : { status: 200, url, headers: { etag: '"e1"' }, body, notModified: false };
    };
    return { fetcher, urls };
  }

  it("never substitutes a similarly named package", async () => {
    const { fetcher, urls } = registryFetcher({ [registryUrl("zod")]: fixture("zod") });
    const retrieval = newRetrieval(new MemoryStore(), new Budget(limitsFromEnv({})), fetcher);
    expect(await resolve(retrieval, { package: "zodd", fromRequested: null, toRequested: "4.0.0" })).toMatchObject({
      kind: "unknown_package",
    });
    expect(urls).toEqual(["https://registry.npmjs.org/zodd"]);
  });

  it("encodes scoped names and reuses the fresh snapshot on the next call", async () => {
    const name = "@tanstack/react-query";
    const { fetcher, urls } = registryFetcher({ [registryUrl(name)]: fixture(name) });
    const store = new MemoryStore();
    const first = await resolve(newRetrieval(store, new Budget(limitsFromEnv({})), fetcher), {
      package: name,
      fromRequested: "4.36.1",
      toRequested: "5.0.0",
    });
    expect(first.kind).toBe("ok");
    expect(urls).toEqual(["https://registry.npmjs.org/@tanstack%2Freact-query"]);
    await resolve(newRetrieval(store, new Budget(limitsFromEnv({})), fetcher), {
      package: name,
      fromRequested: "4.36.1",
      toRequested: "5.0.0",
    });
    expect(urls).toHaveLength(1);
  });

  it("accepts a registry document far larger than the 2 MB default cap", () => {
    // Stands in for the 15 MB typescript document; the registry cap itself is tested in safeFetch.
    const versions = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`1.${i}.0`, { readme: "x".repeat(4000) }]));
    const body = JSON.stringify({ name: "big", versions, time: {}, "dist-tags": {} });
    expect(body.length).toBeGreaterThan(15_000_000);
    expect(Packument.parse(JSON.parse(reducePackument(body))).versions).toHaveLength(4000);
  });
});
