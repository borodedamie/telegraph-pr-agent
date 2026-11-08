import semver from "semver";
import { z } from "zod";
import type { Dependency } from "./scan";

export const MIGRATION_MINER_ID = "7314";
export const migrationPrompt = (dependency: Dependency): string =>
  `What changed in ${dependency.package} from ${dependency.currentVersion} to ${dependency.targetVersion}?`;

// Validate the fields the adapter consumes; the miner owns its full response schema.
const migrationAnswer = z.object({
  outcome: z.literal("found"),
  request: z.object({ ecosystem: z.literal("npm"), package: z.string(), fromResolved: z.string(), toResolved: z.string() }),
  changes: z.array(z.object({
    kind: z.enum(["breaking", "deprecation", "security_fix"]), version: z.string(),
    evidenceType: z.enum(["documented", "repository_evidence", "inferred"]),
    change: z.string().min(1), excerpt: z.string().min(1).nullable(), sourceId: z.string(),
    migration: z.string().nullable(),
  })),
  security: z.object({
    status: z.enum(["complete", "partial", "unavailable", "not_checked"]),
    advisories: z.array(z.object({
      id: z.string(), aliases: z.array(z.string()), sourceId: z.string(),
      fromAffected: z.enum(["yes", "no", "unknown"]), targetAffected: z.enum(["yes", "no", "unknown"]),
      conclusion: z.enum(["fixed_by_upgrade", "still_affected", "introduced_by_upgrade", "not_applicable", "unknown"]),
    })),
  }),
  coverage: z.object({ complete: z.boolean() }),
  sources: z.array(z.object({ id: z.string(), url: z.string().url() })),
});

export const migrationFindings = (response: unknown, dependencies: Dependency[]) => {
  const answer = migrationAnswer.parse(typeof response === "string" ? JSON.parse(response) : response);
  const dependency = dependencies.find((entry) => entry.ecosystem === answer.request.ecosystem
    && entry.package === answer.request.package && entry.currentVersion === answer.request.fromResolved
    && entry.targetVersion === answer.request.toResolved);
  if (!dependency) throw new Error("Miner migration does not match the verified dependency and versions");
  if (answer.security.advisories.some((advisory) => advisory.conclusion === "introduced_by_upgrade")) {
    throw new Error("Miner reports a vulnerability introduced by the target version; manual review required");
  }
  const changes = answer.changes.filter((change) => change.evidenceType === "documented" && change.excerpt
    && semver.valid(change.version) && semver.gt(change.version, dependency.currentVersion)
    && semver.lte(change.version, dependency.targetVersion!));
  const fixed = answer.security.advisories.filter((advisory) => ["complete", "partial"].includes(answer.security.status)
    && advisory.conclusion === "fixed_by_upgrade"
    && advisory.fromAffected === "yes" && advisory.targetAffected === "no");
  if (!changes.length && !fixed.length) return [];
  const sourceIds = [...changes, ...fixed].map((entry) => entry.sourceId);
  const sources = [...new Set(sourceIds.map((id) => {
    const source = answer.sources.find((entry) => entry.id === id);
    if (!source || new URL(source.url).protocol !== "https:" || new URL(source.url).username || new URL(source.url).password) {
      throw new Error("Miner evidence requires a matching HTTPS source without credentials");
    }
    return source.url;
  }))].slice(0, 20);
  const cves = [...new Set(fixed.flatMap((advisory) => [advisory.id, ...advisory.aliases]))]
    .filter((id) => /^CVE-\d{4}-\d{4,}$/.test(id)).slice(0, 50);
  const reason = [
    `Release coverage: ${answer.coverage.complete ? "complete" : "partial"}; security check: ${answer.security.status}. Manual migration review required.`,
    `Advisories still affecting the target: ${answer.security.advisories.filter((advisory) => advisory.targetAffected === "yes").length}.`,
    ...changes.slice(0, 3).map((change) => `${change.kind}: ${change.change.slice(0, 300)} Quote: ${change.excerpt!.slice(0, 300)}${change.migration ? ` Migration: ${change.migration.slice(0, 300)}` : ""}`),
    `Advisories: ${answer.security.advisories.map((advisory) => `${advisory.id}: ${advisory.conclusion}`).join("; ") || "none reported"}.`,
  ].join("\n").slice(0, 4000);
  return [{ ecosystem: dependency.ecosystem, package: dependency.package, source: dependency.source,
    currentVersion: dependency.currentVersion, targetVersion: dependency.targetVersion,
    issue: cves.length ? "cve" : "outdated", reason, cves, sources }];
};
