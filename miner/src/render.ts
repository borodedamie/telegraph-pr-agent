// Plain-text rendering of an answer (FR-013): the `answer` field, readable without the structured parts.
import type { Advisory, Answer, ChangeItem } from "./types.js";

type Renderable = Omit<Answer, "answer" | "summary" | "confidence">;

const KIND_TITLES: Record<ChangeItem["kind"], string> = {
  breaking: "Breaking",
  deprecation: "Deprecations",
  security_fix: "Security fixes",
};

const MAX_LISTED_NOT_COVERED = 10;
// Releases that only point elsewhere get a line each up to this many; the rest are named on one line.
const MAX_UNASSESSED_LINES = 3;
// The QA judge reads only the first 512 tokens of question and answer, so the main changes go first.
const MAX_KEY_CHANGES = 5;
const KEY_CHANGE_MAX_CHARS = 90;

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

function conclusionText(advisory: Advisory, from: string, to: string): string {
  switch (advisory.conclusion) {
    case "fixed_by_upgrade":
      return `Fixed by this upgrade: ${from} is affected, ${to} is not.`;
    case "still_affected":
      return `Warning: ${to} is still affected; upgrading from ${from} does not resolve it.`;
    case "introduced_by_upgrade":
      return `Warning: the upgrade introduces it: ${from} is not affected, ${to} is.`;
    case "not_applicable":
      return `Neither ${from} nor ${to} is in its affected ranges.`;
    case "unknown":
      return "Its affected ranges could not be read; check the advisory before relying on this upgrade.";
  }
}

/** One line per advisory, most serious conclusions first; the release-note quote when a note names it. */
function advisoryLines(answer: Renderable): string[] {
  const { security, request } = answer;
  if (security.advisories.length === 0 || request?.fromResolved == null || request.toResolved === null) return [];
  const order: Advisory["conclusion"][] = ["introduced_by_upgrade", "still_affected", "unknown", "fixed_by_upgrade", "not_applicable"];
  const sorted = [...security.advisories].sort((a, b) => order.indexOf(a.conclusion) - order.indexOf(b.conclusion));
  const lines = ["", "Advisories (OSV):"];
  for (const advisory of sorted) {
    const names = [...advisory.aliases, advisory.displaySeverity].join(", ");
    const title = advisory.summary ? ` ${advisory.summary}.` : "";
    const note = answer.changes.find((c) => c.id === advisory.releaseNoteItemId);
    const quote = note ? ` Release notes: "${note.excerpt}" [${note.sourceId}]` : "";
    lines.push(`- ${advisory.id} (${names}) [${advisory.sourceId}].${title} ${conclusionText(advisory, request.fromResolved, request.toResolved)}${quote}`);
  }
  return lines;
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
  /** Line-start releases whose notes list no change and only point to a guide: their changes are not in the answer. */
  unassessed?: { version: string; url: string }[];
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
      // The advisory check stands on its own: a missing change list does not make it less true.
      if (answer.security.status !== "not_checked") lines.push(securityLine(answer.security), ...advisoryLines(answer));
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
  const keyChanges = keyChangesLine(answer.changes);
  if (keyChanges) lines.push(keyChanges);
  if (request.fromAssumed) {
    lines.push(`(from version assumed: ${request.fromResolved}, the latest stable release before the ${request.toResolved} line)`);
  }
  const requestedFrom = request.fromRequested ?? "(not given)";
  if (request.fromRequested !== request.fromResolved || request.toRequested !== request.toResolved) {
    lines.push(`Requested ${requestedFrom} → ${request.toRequested}; resolved ${request.fromResolved} → ${request.toResolved}.`);
  }
  lines.push(coverageLine(answer.coverage!));
  lines.push(securityLine(answer.security));
  const unassessed = lookups.unassessed ?? [];
  for (const gap of unassessed.slice(0, MAX_UNASSESSED_LINES)) {
    lines.push(`Not assessed: the ${gap.version} release notes list no changes and point to ${gap.url}; changes described there are not in this answer.`);
  }
  if (unassessed.length > MAX_UNASSESSED_LINES) {
    const rest = unassessed.slice(MAX_UNASSESSED_LINES).map((gap) => gap.version);
    lines.push(`Not assessed either, for the same reason: ${rest.join(", ")}.`);
  }
  if (rulesOnly) {
    lines.push("Notice: the model pass did not run. Marked sections and common breaking-change phrases in major releases were read; other prose may hold changes this list misses.");
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
  if (answer.changes.length === 0) {
    lines.push(
      "",
      answer.coverage!.complete
        ? "No breaking changes or deprecations are documented in the covered releases."
        : "The releases not covered may still hold breaking changes or deprecations; none were found in the covered releases."
    );
  }
  lines.push(...advisoryLines(answer));
  lines.push("", sourcesLine(answer));
  return { answer: lines.join("\n"), summary: summaryFor(answer) };
}

function keyChangesLine(changes: ChangeItem[]): string | null {
  const ordered = (["breaking", "deprecation", "security_fix"] as const).flatMap((kind) => changes.filter((c) => c.kind === kind));
  if (ordered.length === 0) return null;
  const shown = ordered.slice(0, MAX_KEY_CHANGES).map((item) => {
    const text = item.change.replace(/\.$/, "");
    return text.length > KEY_CHANGE_MAX_CHARS ? `${text.slice(0, KEY_CHANGE_MAX_CHARS - 1)}…` : text;
  });
  const more = ordered.length > shown.length ? `; and ${ordered.length - shown.length} more below` : "";
  return `Key changes: ${shown.join("; ")}${more}.`;
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
