// Deterministic extraction: headed sections, marked bullets and advisory ids (research R7, step 1).
import type { Section } from "../sources/github.js";
import type { Candidate } from "./candidate.js";

type Kind = Candidate["kind"];

// Release notes are untrusted: these patterns must stay linear on any line, so the captured text starts at
// a non-space and runs to the end of the line (callers trim it). A heading's closing hashes stay in the
// title; only its kind is read from it.
const HEADING = /^\s*(?:#{1,6}\s+(\S.*)|\*\*([^*]+)\*\*:?\s*)$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(\S.*)$/;
const ADVISORY_ID = /\b(CVE-\d{4}-\d{4,}|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})\b/i;
const MIGRATION_HINT = /\b(instead|replace[sd]?|use|migrate to|switch to|rename[sd]? to)\b/i;

function headingKind(title: string): Kind | "migration" | "other" {
  if (/security|vulnerab/i.test(title)) return "security_fix";
  if (/breaking|removed|removal|dropped/i.test(title)) return "breaking";
  if (/deprecat/i.test(title)) return "deprecation";
  if (/migrat|upgrad/i.test(title)) return "migration";
  return "other";
}

// Outside a headed section only explicit markers count: "BREAKING", a conventional-commit "!:", or a
// leading "Deprecated". A bare "remove ..." is too often a chore ("remove duplicate test").
function bulletKind(text: string): Kind | null {
  if (ADVISORY_ID.test(text)) return "security_fix";
  // "non-breaking" and "Breakpoints ..." are not markers.
  if (/(?<!-)\bbreaking\b|^\[break\]|^break:|^\w+(\([^)]*\))?!:/i.test(text)) return "breaking";
  if (/^(\*\*|`)?deprecat/i.test(text)) return removedNow(text) ? "breaking" : "deprecation";
  return null;
}

/** "Deprecated X removed" is a removal in this release; "deprecated, will be removed in v6" is still a deprecation. */
function removedNow(text: string): boolean {
  if (/\b(will|to) be (removed|dropped)\b|\b(in a future|in the next|future (major|release|version))\b/i.test(text)) return false;
  return /\b(removed|dropped)\b/i.test(text);
}

/** A bullet that is only a label ("**Breaking Changes**:") opens a section like a heading. */
function labelKind(text: string): ReturnType<typeof headingKind> | null {
  const label = text.replace(/[*_`:]/g, "").trim();
  return /^(breaking changes?|deprecations?|deprecated|removed|removals|security( fixes)?|migration( guide)?)$/i.test(label)
    ? headingKind(label)
    : null;
}

// In a migration guide every heading names one change; its first words say which kind.
function guideHeadingKind(title: string): Kind | null {
  if (/deprecat/i.test(title)) return "deprecation";
  if (/\b(drops?|dropped|remov\w*|no longer|stricter|changes?|throws|only|breaking|renam\w*|moves?)\b/i.test(title)) {
    return "breaking";
  }
  return null;
}

function migrationLine(lines: string[]): string | null {
  for (const line of lines) {
    const text = line.trim();
    if (text === "" || text.startsWith("```") || HEADING.test(text)) continue;
    if (MIGRATION_HINT.test(text)) return text;
  }
  return null;
}

export interface RulesResult {
  candidates: Candidate[];
  /** Sections the deterministic pass fully handled, so they are not sent to the model. */
  handled: Set<number>;
}

export function extractRules(sections: Section[], isGuide: (section: Section) => boolean): RulesResult {
  const candidates: Candidate[] = [];
  const handled = new Set<number>();
  const add = (section: number, kind: Kind, excerpt: string, migrationExcerpt: string | null) => {
    candidates.push({
      ref: `r${candidates.length + 1}`,
      section,
      kind,
      inferred: false,
      change: excerpt.replace(/^#+\s*/, ""),
      excerpt,
      inferredFrom: [],
      migration: migrationExcerpt,
      migrationExcerpt,
      migrationInferredFrom: [],
    });
  };

  sections.forEach((section, index) => {
    const lines = section.text.split("\n");
    if (isGuide(section)) {
      handled.add(index);
      lines.forEach((line, i) => {
        const heading = /^#{2,4}\s+(\S.*)$/.exec(line);
        if (!heading) return;
        const title = heading[1].trimEnd();
        const kind = guideHeadingKind(title);
        if (kind === null) return;
        const body: string[] = [];
        for (let j = i + 1; j < lines.length && !/^#{1,4}\s/.test(lines[j]); j++) body.push(lines[j]);
        add(index, kind, title, migrationLine(body));
      });
      return;
    }

    let current: ReturnType<typeof headingKind> = "other";
    let inCode = false;
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const heading = HEADING.exec(line);
      if (heading) {
        current = headingKind(heading[1] ?? heading[2]);
        if (current !== "other" && current !== "migration") handled.add(index);
        continue;
      }
      const bullet = BULLET.exec(line);
      if (!bullet) continue;
      const text = bullet[1].trimEnd();
      const label = labelKind(text);
      if (label !== null) {
        current = label;
        if (current !== "other" && current !== "migration") handled.add(index);
        continue;
      }
      if (current === "migration") continue;
      const kind = current === "other" ? bulletKind(text) : ADVISORY_ID.test(text) ? "security_fix" : current;
      if (kind === null) continue;
      add(index, kind, text, MIGRATION_HINT.test(text) ? text : null);
    }
  });
  return { candidates, handled };
}
