import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { answerQuestion, type PipelineDeps } from "../../src/answer.js";
import { MemoryStore } from "../../src/cache.js";
import { correlate } from "../../src/correlate.js";
import type { ModelCaller } from "../../src/extract/model.js";
import { registryUrl } from "../../src/resolve.js";
import { OSV_QUERY_URL, ReducedVuln, reduceOsv } from "../../src/sources/osv.js";
import type { ChangeItem } from "../../src/types.js";
import { ZOD_GITHUB, ZOD_OSV, fixtureFetcher } from "../fixtures.js";

/** The reduced records of one recorded OSV response. */
function vulns(file: string, packageName: string): { vuln: ReducedVuln; sourceId: string }[] {
  const body = readFileSync(new URL(`../fixtures/osv/${file}.json`, import.meta.url), "utf8");
  return (JSON.parse(reduceOsv(body, packageName)) as { vulns: ReducedVuln[] }).vulns.map((vuln) => ({ vuln, sourceId: "s9" }));
}

function securityFix(ids: string[]): ChangeItem {
  return {
    id: "c1", kind: "security_fix", version: "1.2.6", evidenceType: "documented", change: "Fix prototype pollution",
    excerpt: `Fix prototype pollution (${ids.join(", ")})`, inferredFrom: [], migration: null, migrationEvidence: "manual_review",
    migrationExcerpt: null, migrationSourceId: null, migrationInferredFrom: [], ids, sourceId: "s2",
  };
}

const byId = (advisories: ReturnType<typeof correlate>) => Object.fromEntries(advisories.map((a) => [a.id, a]));

describe("correlate (spec User Story 4 table)", () => {
  it("A affected, fixed at or before B, fix documented: the upgrade addresses it, with the note linked", () => {
    const [advisory] = correlate(vulns("minimist@1.2.5", "minimist"), [securityFix(["CVE-2021-44906"])], "1.2.5", "1.2.6");
    expect(advisory).toMatchObject({
      id: "GHSA-xvch-5gv4-984h", displaySeverity: "critical", fromAffected: "yes", targetAffected: "no",
      conclusion: "fixed_by_upgrade", releaseNoteItemId: "c1",
    });
  });

  it("A affected, fixed at or before B, fix not mentioned: the upgrade addresses it per the advisory's ranges", () => {
    const [advisory] = correlate(vulns("minimist@1.2.5", "minimist"), [securityFix(["CVE-1999-0001"])], "1.2.5", "1.2.6");
    expect(advisory).toMatchObject({ conclusion: "fixed_by_upgrade", releaseNoteItemId: null });
  });

  it("no known advisory, security fix documented: no advisory claim; the fix stays a change item", () => {
    expect(correlate([], [securityFix(["CVE-2021-44906"])], "1.2.5", "1.2.6")).toEqual([]);
  });

  it("A affected, still affected at B: the upgrade does not resolve it", () => {
    const advisories = byId(correlate(vulns("lodash@4.17.20", "lodash"), [], "4.17.20", "4.17.21"));
    expect(advisories["GHSA-35jh-r3h4-6jhm"]).toMatchObject({ conclusion: "fixed_by_upgrade", displaySeverity: "high" });
    expect(advisories["GHSA-r5fr-rjxr-66jc"]).toMatchObject({ conclusion: "still_affected", targetAffected: "yes" });
  });

  it("no evidence either way: no claim", () => {
    expect(correlate([], [], "1.0.0", "2.0.0")).toEqual([]);
  });

  it("fixed in an earlier line, affected again in B's line: B is still affected, though newer", () => {
    const [advisory] = correlate(vulns("minimist@1.2.5", "minimist"), [], "0.2.3", "1.2.5");
    expect(advisory).toMatchObject({ fromAffected: "yes", targetAffected: "yes", conclusion: "still_affected" });
  });

  it("A not affected, B affected: the upgrade introduces it", () => {
    const [advisory] = correlate(vulns("minimist@1.2.5", "minimist"), [], "0.2.4", "1.2.5");
    expect(advisory).toMatchObject({ fromAffected: "no", targetAffected: "yes", conclusion: "introduced_by_upgrade" });
  });

  it("a newer version alone is never a security fix", () => {
    const gitOnly: ReducedVuln = {
      id: "GHSA-test-test-test", summary: null, aliases: [], modified: null, severity: [], databaseSeverity: null,
      versions: [], ranges: [{ type: "GIT", events: [{ introduced: "abc" }, { fixed: "def" }] }],
    };
    const [advisory] = correlate([{ vuln: gitOnly, sourceId: "s9" }], [], "1.0.0", "9.0.0");
    expect(advisory).toMatchObject({ fromAffected: "unknown", targetAffected: "unknown", conclusion: "unknown" });
  });

  it("keeps only the asked package's ranges from a record that lists several", () => {
    const [record] = vulns("lodash@4.17.20", "lodash").map((v) => v.vuln).filter((v) => v.id === "GHSA-35jh-r3h4-6jhm");
    // lodash-es, lodash.template and lodash-rails (RubyGems) share the record; only lodash's own entry is kept.
    expect(record.ranges).toEqual([{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }]);
  });
});

describe("the advisory check in the answer", () => {
  const QUESTION = "What changed in zod from 3.23.8 to 4.0.0?";
  const FILES: Record<string, string> = { [registryUrl("zod")]: "npm/zod.json", ...ZOD_GITHUB, ...ZOD_OSV };
  const emptyModel: ModelCaller = async () => ({ text: '{"items":[]}', costMicroUsdc: 10_000 });
  const deps = (store: MemoryStore, fetcher: PipelineDeps["fetcher"]): PipelineDeps => ({
    store, env: { LLM_MINERS: "302:POST:/gen" }, fetcher, caller: emptyModel,
  });

  it("lists each advisory with its conclusion and an advisory source, and caches a complete check", async () => {
    const store = new MemoryStore();
    const { answer } = await answerQuestion(QUESTION, deps(store, fixtureFetcher(FILES).fetcher));
    expect(answer.security.status).toBe("complete");
    const [advisory] = answer.security.advisories;
    expect(advisory).toMatchObject({ id: "GHSA-mrhx-c7xc-m3w5", conclusion: "still_affected" });
    expect(answer.sources.find((s) => s.id === advisory.sourceId)).toMatchObject({ type: "advisory", trust: "advisory_db", url: OSV_QUERY_URL });
    expect(answer.answer).toContain("- GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404, high)");
    expect(answer.answer).toContain("Warning: 4.0.0 is still affected; upgrading from 3.23.8 does not resolve it.");
    expect((await answerQuestion(QUESTION, deps(store, fixtureFetcher(FILES).fetcher))).cacheHit).toBe(true);
  });

  it("still answers found when OSV is down, says the check was unavailable and is not cached", async () => {
    const store = new MemoryStore();
    const { fetcher } = fixtureFetcher(FILES);
    const osvDown: typeof fetcher = async (url, options) =>
      url === OSV_QUERY_URL ? { status: 503, url, headers: {}, body: "", notModified: false } : fetcher(url, options);
    const first = await answerQuestion(QUESTION, deps(store, osvDown));
    expect(first.answer.outcome).toBe("found");
    expect(first.answer.security).toMatchObject({ status: "unavailable", checkedAt: null, advisories: [] });
    expect(first.answer.answer).toContain("Security: OSV could not be reached; advisories were not checked.");
    expect(first.answer.answer).not.toContain("no known advisories");
    expect((await answerQuestion(QUESTION, deps(store, osvDown))).cacheHit).toBe(false);
  });

  it("reports a check where one of the two queries failed as partial", async () => {
    const { fetcher } = fixtureFetcher(FILES);
    const targetDown: typeof fetcher = async (url, options) =>
      options?.body?.includes('"4.0.0"') ? { status: 503, url, headers: {}, body: "", notModified: false } : fetcher(url, options);
    const { answer } = await answerQuestion(QUESTION, deps(new MemoryStore(), targetDown));
    expect(answer.security.status).toBe("partial");
    expect(answer.security.advisories.map((a) => a.id)).toEqual(["GHSA-mrhx-c7xc-m3w5"]);
  });

  it("computes a new answer when the OSV response changes", async () => {
    const store = new MemoryStore();
    await answerQuestion(QUESTION, deps(store, fixtureFetcher(FILES).fetcher));
    const changed = { ...FILES, [`${OSV_QUERY_URL}#zod@4.0.0`]: "osv/empty.json" };
    // Manifests are fresh for an hour; two hours later every source is read again.
    const later = Date.now() + 2 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      const second = await answerQuestion(QUESTION, deps(store, fixtureFetcher(changed).fetcher));
      expect(second.cacheHit).toBe(false);
      // The record read for A still puts 4.0.0 in its range: the conclusion follows the ranges, not which query found it.
      expect(second.answer.security.advisories[0]).toMatchObject({ conclusion: "still_affected" });
    } finally {
      vi.restoreAllMocks();
    }
  });
});
