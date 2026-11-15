import { expect, it } from "vitest";
import { migrationFindings, migrationPrompt } from "../src/miner-assessment.js";
import { parseFindings } from "../src/assessment.js";
import { parse } from "../../miner/src/parse.js";

const dependency = { ecosystem: "npm" as const, package: "express", source: "package.json", declared: "^4.21.0",
  currentVersion: "4.21.0", targetVersion: "5.0.0" };
const response = () => ({ outcome: "found", request: { ecosystem: "npm", package: "express", fromResolved: "4.21.0", toResolved: "5.0.0" },
  changes: [{ kind: "breaking", version: "5.0.0", evidenceType: "documented", change: "Removed old API",
    excerpt: "The old API is removed.", sourceId: "s1", migration: "Use the new API." }],
  coverage: { complete: false }, security: { status: "complete", advisories: [{ id: "GHSA-example", aliases: ["CVE-2025-12345"],
    fromAffected: "yes", targetAffected: "no", conclusion: "fixed_by_upgrade", sourceId: "s2" }] },
  sources: [{ id: "s1", url: "https://expressjs.com/guide/migrating-5.html" }, { id: "s2", url: "https://osv.dev/vulnerability/GHSA-example" }] });

it("asks an exact two-version question understood by the project's miner parser", () => {
  expect(parse(migrationPrompt(dependency))).toEqual({ kind: "ok", package: "express", fromRequested: "4.21.0", toRequested: "5.0.0" });
});

it("adapts quoted changes and fixed advisories into validated findings with coverage caveats", () => {
  const findings = migrationFindings(response(), [dependency]);
  expect(parseFindings(JSON.stringify({ findings }), [dependency])).toEqual(findings);
  expect(findings[0]).toMatchObject({ package: "express", issue: "cve", cves: ["CVE-2025-12345"],
    sources: response().sources.map((source) => source.url) });
  expect(findings[0].reason).toContain("Release coverage: partial");
  expect(findings[0].reason).toContain("Documented changes: 1 breaking, 0 deprecation, 0 security fix.");
  expect(findings[0].changes).toEqual([{ kind: "breaking", version: "5.0.0", change: "Removed old API",
    quote: "The old API is removed.", migration: "Use the new API." }]);
});

it("lists every documented change, breaking first, then deprecations, then security fixes, oldest version first", () => {
  const answer = response();
  const change = (kind: string, version: string, text: string) => ({ kind, version, evidenceType: "documented",
    change: text, excerpt: `${text}.`, sourceId: "s1", migration: null });
  answer.changes = [change("security_fix", "4.21.2", "sec"), change("deprecation", "4.22.0", "dep"),
    change("breaking", "5.0.0", "b2"), change("breaking", "4.22.0", "b1"), change("deprecation", "4.21.1", "dep0"),
    change("breaking", "4.21.1", "b0"), change("breaking", "4.21.3", "b0b")] as unknown as typeof answer.changes;
  const { changes } = migrationFindings(answer, [dependency])[0];
  expect(changes!.map((entry) => `${entry.kind}:${entry.version}`)).toEqual([
    "breaking:4.21.1", "breaking:4.21.3", "breaking:4.22.0", "breaking:5.0.0",
    "deprecation:4.21.1", "deprecation:4.22.0", "security_fix:4.21.2"]);
});

it("drops a quote or migration that only repeats the change text", () => {
  const answer = response();
  answer.changes[0] = { ...answer.changes[0], change: "Removed old API", excerpt: "Removed old API", migration: "Removed old API" };
  expect(migrationFindings(answer, [dependency])[0].changes![0]).toMatchObject({ quote: null, migration: null });
});

it.each(["needs_clarification", "temporarily_unavailable"])("rejects %s without inventing findings", (outcome) => {
  expect(() => migrationFindings({ ...response(), outcome }, [dependency])).toThrow();
});

it.each(["package", "version", "source", "introduced"])("rejects unsafe or mismatched %s evidence", (field) => {
  const answer = response();
  if (field === "package") answer.request.package = "other";
  if (field === "version") answer.request.toResolved = "6.0.0";
  if (field === "source") answer.sources[0].url = "http://example.org";
  if (field === "introduced") answer.security.advisories[0].conclusion = "introduced_by_upgrade";
  expect(() => migrationFindings(answer, [dependency])).toThrow();
});

it("does not turn inferred changes or an unresolved CVE into an upgrade finding", () => {
  const answer = response();
  answer.changes[0].evidenceType = "inferred";
  answer.security.advisories[0].conclusion = "still_affected";
  answer.security.advisories[0].targetAffected = "yes";
  expect(migrationFindings(answer, [dependency])).toEqual([]);
});

it("retains GHSA-only fixed evidence without inventing a CVE identifier", () => {
  const answer = response();
  answer.changes = [];
  answer.security.advisories[0].aliases = [];
  const finding = migrationFindings(JSON.stringify(answer), [dependency])[0];
  expect(finding).toMatchObject({ issue: "outdated", cves: [], sources: ["https://osv.dev/vulnerability/GHSA-example"] });
  expect(finding.reason).toContain("GHSA-example: fixed_by_upgrade");
});

it("classifies valid not_found separately, including null request and coverage", () => {
  expect(() => migrationFindings({ ...response(), outcome: "not_found", request: null, coverage: null,
    changes: [], security: { status: "not_checked", advisories: [] }, sources: [] }, [dependency]))
    .toThrow("Suitable release information was not found");
});
