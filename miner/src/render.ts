// Plain-text rendering of an answer (FR-013): the `answer` field, readable without the structured parts.
import type { Answer, ChangeItem } from "./types.js";

type Renderable = Omit<Answer, "answer" | "summary" | "confidence">;

const KIND_TITLES: Record<ChangeItem["kind"], string> = {
  breaking: "Breaking",
  deprecation: "Deprecations",
  security_fix: "Security fixes",
};

const MAX_LISTED_NOT_COVERED = 10;

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

function counts(changes: ChangeItem[]): string {
  const breaking = changes.filter((c) => c.kind === "breaking").length;
  const deprecations = changes.filter((c) => c.kind === "deprecation").length;
  const fixes = changes.filter((c) => c.kind === "security_fix").length;
  const parts = [plural(breaking, "breaking change"), plural(deprecations, "deprecation")];
  if (fixes > 0) parts.push(plural(fixes, "documented security fix", "documented security fixes"));
  return parts.join(", ");
}

export function coverageLine(coverage: NonNullable<Answer["coverage"]>): string {
  if (coverage.complete) return `Coverage complete (${plural(coverage.covered.length, "release")}).`;
  const listed = coverage.notCovered
    .slice(0, MAX_LISTED_NOT_COVERED)
    .map((n) => `${n.version} (${n.reason.replace("_", " ")})`)
    .join(", ");
  const more = coverage.notCovered.length - MAX_LISTED_NOT_COVERED;
  return `Coverage partial: ${coverage.covered.length} of ${coverage.covered.length + coverage.notCovered.length} releases covered; not covered ${listed}${more > 0 ? ` and ${more} more` : ""}.`;
}

function securityLine(security: Answer["security"]): string {
  switch (security.status) {
    case "complete":
      return security.advisories.length === 0
        ? `Security: OSV checked at ${security.checkedAt}, no known advisories.`
        : `Security: OSV checked at ${security.checkedAt}, ${plural(security.advisories.length, "advisory", "advisories")}.`;
    case "partial":
      return "Security: the OSV check was partial; the advisory list may be incomplete.";
    case "unavailable":
      return "Security: OSV could not be reached; advisories were not checked.";
    case "not_checked":
      return "Security: advisories were not checked.";
  }
}

function migrationText(item: ChangeItem): string {
  if (item.migrationEvidence === "manual_review") return "Migration: manual review needed.";
  return `Migrate (${item.migrationEvidence}): ${item.migration}`;
}

const NOT_SAFE = "This is not a sign that the upgrade is safe: no change list could be built, so review it before upgrading.";

export interface Lookups {
  /** URLs read, or answered "does not exist" (404). */
  checked: string[];
  /** URLs looked up but not read: an outage, a timeout or over the size cap. */
  unreadable: string[];
}

export function render(
  answer: Renderable,
  rulesOnly: boolean,
  lookups: Lookups = { checked: [], unreadable: [] }
): { answer: string; summary: string } {
  const request = answer.request;
  if (answer.outcome !== "found" || request === null || request.fromResolved === null || request.toResolved === null) {
    const summary = answer.clarification ?? summaryFor(answer);
    const lines = [summary];
    if (answer.outcome === "not_found") {
      if (answer.coverage !== null) lines.push(coverageLine(answer.coverage));
      const looked = lookups.checked.length > 0 ? lookups.checked : answer.sources.map((s) => s.url);
      if (looked.length > 0) lines.push(`Checked: ${looked.join(", ")}.`);
      if (lookups.unreadable.length > 0) {
        lines.push(`Could not read, so material may exist that this answer did not see: ${lookups.unreadable.join(", ")}.`);
      }
      lines.push(NOT_SAFE);
    }
    if (answer.outcome === "temporarily_unavailable") {
      lines.push("This is not an answer about the upgrade: its release material could not be read yet.");
    }
    if (answer.sources.length > 0) lines.push("", sourcesLine(answer));
    return { answer: lines.join("\n"), summary };
  }

  const released = answer.targetReleasedAt ? ` (released ${answer.targetReleasedAt.slice(0, 10)})` : "";
  const header = `${request.package} ${request.fromResolved} → ${request.toResolved}${released}: ${counts(answer.changes)}.`;
  const lines = [header];
  if (request.fromAssumed) {
    lines.push(`(from version assumed: ${request.fromResolved}, the latest stable release before the ${request.toResolved} line)`);
  }
  const requestedFrom = request.fromRequested ?? "(not given)";
  if (request.fromRequested !== request.fromResolved || request.toRequested !== request.toResolved) {
    lines.push(`Requested ${requestedFrom} → ${request.toRequested}; resolved ${request.fromResolved} → ${request.toResolved}.`);
  }
  lines.push(coverageLine(answer.coverage!));
  lines.push(securityLine(answer.security));
  if (rulesOnly) {
    lines.push("Notice: the model pass did not run, so changes written as prose may be missing. Only marked sections were read.");
  }

  let number = 0;
  for (const kind of ["breaking", "deprecation", "security_fix"] as const) {
    const items = answer.changes.filter((c) => c.kind === kind);
    if (items.length === 0) continue;
    lines.push("", `${KIND_TITLES[kind]}:`);
    for (const item of items) {
      number++;
      const evidence =
        item.evidenceType === "inferred"
          ? `Inferred from ${item.inferredFrom.join(", ")}.`
          : `Evidence (${item.evidenceType.replace("_", " ")}): "${item.excerpt}" [${item.sourceId}]`;
      lines.push(`${number}. ${item.change} (${item.version}). ${migrationText(item)} ${evidence}`);
    }
  }
  if (answer.changes.length === 0) lines.push("", "No breaking changes or deprecations are documented in the covered releases.");
  lines.push("", sourcesLine(answer));
  return { answer: lines.join("\n"), summary: summaryFor(answer) };
}

function sourcesLine(answer: Renderable): string {
  return `Sources: ${answer.sources.map((s) => `[${s.id}] ${s.url}`).join(" ")}`;
}

function summaryFor(answer: Renderable): string {
  const request = answer.request;
  switch (answer.outcome) {
    case "found": {
      const coverage = answer.coverage!.complete ? "coverage complete" : "coverage partial";
      return `Upgrading ${request!.package} ${request!.fromResolved} → ${request!.toResolved}: ${counts(answer.changes)} found in the release material; ${coverage}.`;
    }
    case "not_found":
      return request
        ? `No release material found for ${request.package} ${request.fromResolved ?? request.fromRequested ?? "?"} → ${request.toResolved ?? request.toRequested ?? "?"}.`
        : "Nothing was found for this question.";
    case "needs_clarification":
      return "The question needs a clearer package or version.";
    case "out_of_scope":
      return "This miner answers questions about npm package upgrades only.";
    case "temporarily_unavailable":
      return "A required source is temporarily unavailable; try again later.";
  }
}
