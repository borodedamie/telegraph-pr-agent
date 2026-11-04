// Mechanical evidence checks (research R7, FR-010, FR-010a): nothing reaches the answer without a verified excerpt.
import type { Section } from "../sources/github.js";
import type { ChangeItem } from "../types.js";
import type { Candidate } from "./candidate.js";

/**
 * Text with inline markdown (backticks, `*`, `_`, a leading list marker) removed and whitespace runs collapsed,
 * plus, for each kept character, its index in the original.
 */
function strip(text: string): { stripped: string; map: number[] } {
  let stripped = "";
  const map: number[] = [];
  let lineStart = true;
  for (let i = 0; i < text.length; i++) {
    if (lineStart) {
      const marker = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/.exec(text.slice(i, i + 12));
      if (marker) i += marker[0].length;
      lineStart = false;
      if (i >= text.length) break;
    }
    const char = text[i];
    if (char === "\n") lineStart = true;
    if (char === "`" || char === "*" || char === "_") continue;
    if (/\s/.test(char)) {
      if (stripped.endsWith(" ") || stripped === "") continue;
      stripped += " ";
      map.push(i);
      continue;
    }
    stripped += char;
    map.push(i);
  }
  return { stripped, map };
}

type Stripped = ReturnType<typeof strip>;

/** The original span of `source` that `excerpt` matches, ignoring inline markup; null when it is not there. */
export function findSpan(source: string, excerpt: string): string | null {
  return spanIn(source, strip(source), excerpt);
}

/** findSpan with `source` already stripped, so one section is stripped once for all its candidates. */
function spanIn(source: string, { stripped, map }: Stripped, excerpt: string): string | null {
  const needle = strip(excerpt).stripped.trim();
  if (needle === "") return null;
  const at = stripped.indexOf(needle);
  if (at === -1) return null;
  let end = map[at + needle.length - 1] + 1;
  // Keep a closing backtick or emphasis mark that belongs to the span.
  while (end < source.length && "`*_".includes(source[end])) end++;
  let start = map[at];
  while (start > 0 && "`*_".includes(source[start - 1])) start--;
  return source.slice(start, end);
}

const ADVISORY_IDS = /\b(CVE-\d{4}-\d{4,}|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})\b/gi;
/** A documented migration step must quote at least this much of its source. */
const MIN_MIGRATION_EXCERPT = 12;

export interface VerifySource {
  id: string;
  type: "release" | "changelog" | "migration_guide" | "tag_compare";
}

export interface Drop {
  ref: string;
  reason: string;
}

export interface VerifyResult {
  items: ChangeItem[];
  dropped: Drop[];
  downgraded: Drop[];
}

/** `sources[i]` is the source of consulted document i; sections point into it. */
export function verify(candidates: Candidate[], sections: Section[], sources: VerifySource[]): VerifyResult {
  const dropped: Drop[] = [];
  const downgraded: Drop[] = [];
  const spans = new Map<string, string>();
  const seen = new Set<string>();
  const prepared = new Map<Section, Stripped>();
  const strippedOf = (section: Section): Stripped => {
    let entry = prepared.get(section);
    if (entry === undefined) prepared.set(section, (entry = strip(section.text)));
    return entry;
  };

  // Pass 1: evidence-backed candidates.
  for (const candidate of candidates.filter((c) => !c.inferred)) {
    const section = sections[candidate.section];
    if (!section) {
      dropped.push({ ref: candidate.ref, reason: "unknown section" });
      continue;
    }
    const span = candidate.excerpt === null ? null : spanIn(section.text, strippedOf(section), candidate.excerpt);
    if (span === null) {
      dropped.push({ ref: candidate.ref, reason: candidate.excerpt === null ? "no excerpt" : "excerpt not in source" });
      continue;
    }
    const key = `${section.version}\u0000${span}`;
    if (seen.has(key)) {
      dropped.push({ ref: candidate.ref, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    spans.set(candidate.ref, span);
  }
  // Pass 2: inferred candidates must rest on kept ones.
  const kept = new Set(spans.keys());
  for (const candidate of candidates.filter((c) => c.inferred)) {
    if (!sections[candidate.section] || !candidate.inferredFrom.some((ref) => kept.has(ref))) {
      dropped.push({ ref: candidate.ref, reason: "inferred from nothing kept" });
      continue;
    }
    kept.add(candidate.ref);
  }

  const ids = new Map<string, string>();
  const ordered = candidates.filter((c) => kept.has(c.ref));
  ordered.forEach((c, i) => ids.set(c.ref, `c${i + 1}`));

  const items = ordered.map((candidate): ChangeItem => {
    const section = sections[candidate.section];
    const source = sources[section.consulted];
    const excerpt = spans.get(candidate.ref) ?? null;
    const item: ChangeItem = {
      id: ids.get(candidate.ref)!,
      kind: candidate.kind,
      version: section.version,
      evidenceType: candidate.inferred ? "inferred" : source.type === "tag_compare" ? "repository_evidence" : "documented",
      change: candidate.change,
      excerpt,
      inferredFrom: candidate.inferredFrom.filter((ref) => ids.has(ref)).map((ref) => ids.get(ref)!),
      migration: null,
      migrationEvidence: "manual_review",
      migrationExcerpt: null,
      migrationSourceId: null,
      migrationInferredFrom: [],
      ids: excerpt === null ? [] : [...new Set([...excerpt.matchAll(ADVISORY_IDS)].map((m) => m[1].toUpperCase()))],
      sourceId: source.id,
    };

    const migration = verifyMigration(candidate, section, sections, sources, strippedOf);
    if (migration.kind === "documented") {
      // The step shown is the source's own words, so it cannot claim more than the source says.
      item.migration = migration.span;
      item.migrationEvidence = "documented";
      item.migrationExcerpt = migration.span;
      item.migrationSourceId = migration.sourceId;
    } else {
      const evidence = candidate.migrationInferredFrom
        .map((ref) => ids.get(ref) ?? sectionSource(ref, sections, sources))
        .filter((id): id is string => id !== null);
      if (candidate.migration !== null && evidence.length > 0) {
        item.migration = candidate.migration;
        item.migrationEvidence = "inferred";
        item.migrationInferredFrom = [...new Set(evidence)];
      }
      if (candidate.migration !== null && candidate.migrationExcerpt !== null) {
        downgraded.push({ ref: candidate.ref, reason: `migration excerpt not verified: now ${item.migrationEvidence}` });
      }
    }
    return item;
  });

  for (const entry of [...dropped, ...downgraded]) {
    console.info(JSON.stringify({ kind: "evidence_check", ...entry }));
  }
  return { items, dropped, downgraded };
}

function sectionSource(ref: string, sections: Section[], sources: VerifySource[]): string | null {
  const match = /^section:(\d+)$/.exec(ref);
  const section = match ? sections[Number(match[1])] : undefined;
  return section ? sources[section.consulted].id : null;
}

function verifyMigration(
  candidate: Candidate,
  own: Section,
  sections: Section[],
  sources: VerifySource[],
  strippedOf: (section: Section) => Stripped
): { kind: "documented"; span: string; sourceId: string } | { kind: "none" } {
  if (candidate.migrationExcerpt === null) return { kind: "none" };
  // The step's own excerpt: its section first, then any section of the same release.
  for (const section of [own, ...sections.filter((s) => s !== own && s.version === own.version)]) {
    const span = spanIn(section.text, strippedOf(section), candidate.migrationExcerpt);
    if (span !== null && span.length >= MIN_MIGRATION_EXCERPT) {
      return { kind: "documented", span, sourceId: sources[section.consulted].id };
    }
  }
  return { kind: "none" };
}
