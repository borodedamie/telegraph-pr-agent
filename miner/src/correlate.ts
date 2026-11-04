// Per-advisory conclusions for A → B (spec User Story 4 table). With no evidence, no claim is made.
import { isAffected } from "./affected.js";
import type { ReducedVuln } from "./sources/osv.js";
import type { Advisory, ChangeItem } from "./types.js";

const SEVERITIES: Record<string, Advisory["displaySeverity"]> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "moderate",
  MEDIUM: "moderate",
  LOW: "low",
};

function conclusionFor(from: Advisory["fromAffected"], target: Advisory["targetAffected"]): Advisory["conclusion"] {
  if (from === "unknown" || target === "unknown") return "unknown";
  if (from === "yes") return target === "yes" ? "still_affected" : "fixed_by_upgrade";
  return target === "yes" ? "introduced_by_upgrade" : "not_applicable";
}

export function correlate(
  vulns: { vuln: ReducedVuln; sourceId: string }[],
  changes: ChangeItem[],
  from: string,
  to: string
): Advisory[] {
  const fixes = changes.filter((c) => c.kind === "security_fix");
  return vulns.map(({ vuln, sourceId }): Advisory => {
    const ranges = vuln.ranges;
    const fromAffected = isAffected({ affectedVersions: vuln.versions, ranges }, from);
    const targetAffected = isAffected({ affectedVersions: vuln.versions, ranges }, to);
    // A release note is linked only by an id it names: a fix in the same release proves nothing by itself.
    const names = new Set([vuln.id, ...vuln.aliases].map((id) => id.toUpperCase()));
    const note = fixes.find((c) => c.ids.some((id) => names.has(id.toUpperCase())));
    return {
      id: vuln.id,
      summary: vuln.summary,
      aliases: vuln.aliases,
      severity: vuln.severity,
      displaySeverity: SEVERITIES[vuln.databaseSeverity?.toUpperCase() ?? ""] ?? "unknown",
      affectedVersions: vuln.versions,
      ranges,
      fromAffected,
      targetAffected,
      conclusion: conclusionFor(fromAffected, targetAffected),
      releaseNoteItemId: note?.id ?? null,
      sourceId,
    };
  });
}
