import { expect, it } from "vitest";
import { migrationFindings, migrationPrompt } from "../actions/src/miner-assessment.js";
import { parseFindings } from "../actions/src/assessment.js";
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
  expect(findings[0].reason).toContain("Quote: The old API is removed.");
  expect(findings[0].reason).toContain("Migration: Use the new API.");
});

it.each(["needs_clarification", "not_found", "temporarily_unavailable"])("rejects %s without inventing findings", (outcome) => {
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
  answer.security.advisories[0].aliases = [];
  expect(migrationFindings(JSON.stringify(answer), [dependency])[0]).toMatchObject({ issue: "outdated", cves: [] });
});
