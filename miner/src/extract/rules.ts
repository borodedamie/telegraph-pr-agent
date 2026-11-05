// Deterministic extraction: headed sections, marked bullets, breaking-change phrases and advisory ids
// (research R7, step 1).
import semver from "semver";
import type { Consulted, Section } from "../sources/github.js";
import type { Candidate } from "./candidate.js";

type Kind = Candidate["kind"];

// Release notes are untrusted: these patterns must stay linear on any line, so the captured text starts at
// a non-space and runs to the end of the line (callers trim it). A heading's closing hashes stay in the
// title; only its kind is read from it.
const HEADING = /^\s*(?:#{1,6}\s+(\S.*)|\*\*([^*]+)\*\*:?\s*)$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(\S.*)$/;
const ADVISORY_ID = /\b(CVE-\d{4}-\d{4,}|GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})\b/i;
const MIGRATION_HINT = /\b(instead|replace[sd]?|use|migrate to|switch to|rename[sd]? to)\b/i;

function headingKind(title: string): Kind | "migration" | "fix" | "other" {
  if (/security|vulnerab/i.test(title)) return "security_fix";
  if (/breaking|\bremov(e|es|ed|al|als)\b|dropped/i.test(title)) return "breaking";
  if (/deprecat/i.test(title)) return "deprecation";
  if (/migrat|upgrad/i.test(title)) return "migration";
  // Under a fixes heading "X no longer crashes" is a fix, so phrases are not read there.
  if (/\bfix|\bbug/i.test(title)) return "fix";
  return "other";
}

/**
 * Phrases that mark a breaking change in unmarked text. Chosen from 284 major-release notes of 89 popular
 * packages (miner/bench/phrase-rules.md): each is far more common under Breaking headings than under Features
 * or Fixes. Every pattern is bounded, so it stays linear on untrusted text.
 */
const BREAKING_PHRASES: RegExp[] = [
  /\bno longer\b|\bnot supported anymore\b/i,
  /\b(has been|have been|was|were|is|are|been) removed\b|^\W*remov(e|ed|es)\b/i,
  /\bdrop(s|ped)?\b.{0,20}\bsupport\b|^\W*drop(s|ped)? (node|ie\d*|the|support)\b/i,
  /\brequires? node\b|\bminimum (supported )?(node|version)\b|\bnode(\.js)? (>=|v?\d+\+|\d+ or (higher|later))/i,
  /\brenamed\b|^\W*rename[sd]? .{0,40}\bto\b/i,
  /\bin favou?r of\b/i,
  /\b(has been|have been|was|were|is|are|been) replaced\b|\breplaced (by|with)\b/i,
  /\buse\b.{1,60}\binstead\b|\binstead,? use\b/i,
  /\bdefaults? (is now|are now|changed|has changed|now)\b|\bchange[sd]? the default\b|\b(to be|now) `?(true|false|enabled|disabled)`? by default\b/i,
  /\bis now (required|mandatory|async|asynchronous|esm|a promise)\b|\bnow requires?\b|\bmust now\b/i,
  /\besm[- ]only\b|\bpure esm\b|\bdrop(s|ped)? (commonjs|cjs)\b/i,
  /\bnow throws?\b|\bwill (now )?throw\b/i,
  /\bremove[sd]? (the |all )?deprecated\b|\bdeprecated .{0,40}\bremoved\b/i,
  /\bpreviously\b/i,
  /\bchange[sd]? (the )?(signature|behaviou?r|return type|type of|format)\b/i,
];
// Maintenance lines that use the same words: "remove duplicate test", "drop unused dependency".
const CHORE = /\b(tests?|typos?|lint(ing)?|ci|docs?|readme|comments?|dev ?dependenc\w*|unused|internal(ly)?|dead code|duplicate|chore|refactor\w*|examples?)\b/i;

/** The kind a phrase gives unmarked text, or null. */
function phraseKind(text: string): Kind | null {
  // Code spans are names, not words: `react-test-renderer` is not a chore about tests.
  if (CHORE.test(text.replace(/`[^`]{0,200}`/g, "")) || !BREAKING_PHRASES.some((phrase) => phrase.test(text))) return null;
  // "will be removed in a future version" announces a later removal; it breaks nothing now.
  if (/\b(will|to) be (removed|dropped)\b|\bin a future\b/i.test(text)) return /deprecat/i.test(text) ? "deprecation" : null;
  return "breaking";
}

/** The first release of a breaking-change line: x.0.0, or 0.y.0. Phrases are read only there. */
function isLineStart(version: string): boolean {
  const parsed = semver.parse(version);
  if (parsed === null || parsed.prerelease.length > 0 || parsed.patch !== 0) return false;
  return parsed.major === 0 ? parsed.minor > 0 : parsed.minor === 0;
}

// A link to a guide or announcement: what a line-start release's notes point to when they list no changes.
const GUIDE_LINK = /\[([^\]]{0,80}\b(?:migrat\w*|upgrad\w*|guide|blog|announc\w*|release notes|what'?s new)\b[^\]]{0,80})\]\((https:\/\/[^)\s]{1,300})\)/i;
// The same, plus a changelog, as a markdown link or a bare URL: "See the changelog: https://.../CHANGELOG.md#v700".
const POINTER_LINK =
  /\[([^\]]{0,80}\b(?:migrat\w*|upgrad\w*|guide|blog|announc\w*|release notes?|what'?s new|changelog)\b[^\]]{0,80})\]\((https:\/\/[^)\s]{1,300})\)|(https:\/\/[^\s)\]]{0,300}(?:changelog|migrat|upgrad|blog|announc)[^\s)\]]{0,300})/i;
const LINK_OR_URL = /\[[^\]]{0,200}\]\([^)\s]{0,400}\)|https?:\/\/\S{1,400}/g;
// Release notes with less prose than this, once links are taken out, list nothing of their own.
const POINTER_MAX_CHARS = 300;

/**
 * The page that release notes send the reader to, when the notes are only that pointer: TypeScript's
 * "For release notes, check out the [release announcement](...)", react-router's "See the changelog: ...".
 */
export function pointerLink(text: string): string | null {
  const link = POINTER_LINK.exec(text);
  if (link === null) return null;
  const prose = text.replace(LINK_OR_URL, "").replace(/[\s#*=_`>-]+/g, " ").trim();
  return prose.length < POINTER_MAX_CHARS ? link[2] ?? link[3] : null;
}
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z`*_])/;

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
  // express's History.md labels its groups "breaking:" and "remove:".
  return /^(breaking( changes?)?|deprecations?|deprecated|remove[sd]?|removals|security( fixes)?|migration( guide)?)$/i.test(label)
    ? headingKind(label)
    : null;
}

// In a migration guide every heading names one change; its first words say which kind.
function guideHeadingKind(title: string): Kind | null {
  // "Breaking changes for users" groups the changes below it; it is not one.
  if (/^(breaking changes?|deprecations?)\b/i.test(title)) return null;
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
  /** Line-start sections where nothing was found and the notes point elsewhere: their changes are not assessed. */
  unassessed: { section: number; url: string }[];
}

export function extractRules(sections: Section[], sourceType: (section: Section) => Consulted["type"]): RulesResult {
  const candidates: Candidate[] = [];
  const handled = new Set<number>();
  const unassessed: RulesResult["unassessed"] = [];
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
    if (sourceType(section) === "migration_guide") {
      handled.add(index);
      lines.forEach((line, i) => {
        const heading = /^#{2,4}\s+(\S.*)$/.exec(line);
        if (!heading) return;
        // Anchors before the title are markup, not words: eslint's `<a name="drop-old-node"></a> Node.js < v18.18 ...`.
        const title = heading[1].replace(/^(<a [^>]{0,200}><\/a>\s*)+/i, "").trimEnd();
        const kind = guideHeadingKind(title);
        if (kind === null) return;
        const body: string[] = [];
        for (let j = i + 1; j < lines.length && !/^#{1,4}\s/.test(lines[j]); j++) body.push(lines[j]);
        add(index, kind, title, migrationLine(body));
      });
      return;
    }

    // Release notes and changelogs of a line-start release are also read for phrases; code diffs never are.
    const phrases = sourceType(section) !== "tag_compare" && isLineStart(section.version);
    const found = candidates.length;
    let current: ReturnType<typeof headingKind> = "other";
    // A label bullet ("* breaking:") whose items are nested under it ends at the next bullet that is not.
    type Label = { indent: number; outer: ReturnType<typeof headingKind>; nested: boolean | null };
    let label = null as Label | null;
    let marked = false;
    let inCode = false;
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const heading = HEADING.exec(line);
      if (heading) {
        label = null;
        current = headingKind(heading[1] ?? heading[2]);
        marked ||= current === "breaking" || current === "deprecation" || current === "security_fix";
        continue;
      }
      const bullet = BULLET.exec(line);
      if (!bullet) {
        // Prose paragraphs: "Storybook 10 contains one breaking change: it's ESM-only."
        if (!phrases || current !== "other" || !/^\s*[A-Za-z`*_]/.test(line)) continue;
        // Only phrases count here: a sentence that merely mentions "breaking changes" introduces a list.
        for (const sentence of line.trim().split(SENTENCE_END)) {
          const kind = phraseKind(sentence);
          if (kind !== null) add(index, kind, sentence, MIGRATION_HINT.test(sentence) ? sentence : null);
        }
        continue;
      }
      const text = bullet[1].trimEnd();
      const indent = line.length - line.trimStart().length;
      if (label !== null) {
        label.nested ??= indent > label.indent;
        if (label.nested && indent <= label.indent) {
          current = label.outer;
          label = null;
        }
      }
      const kindOfLabel = labelKind(text);
      if (kindOfLabel !== null) {
        label = { indent, outer: label?.outer ?? current, nested: null };
        current = kindOfLabel;
        marked ||= current === "breaking" || current === "deprecation" || current === "security_fix";
        continue;
      }
      if (current === "migration") continue;
      const kind =
        current === "other" || current === "fix"
          ? bulletKind(text) ?? (phrases && current === "other" ? phraseKind(text) : null)
          : ADVISORY_ID.test(text) ? "security_fix" : current;
      if (kind === null) continue;
      add(index, kind, text, MIGRATION_HINT.test(text) ? text : null);
    }
    // A line-start release is never "handled" by headings alone: its unmarked prose may still hold changes.
    if (marked && !phrases) handled.add(index);
    if (candidates.length === found) {
      const pointer = pointerLink(section.text);
      // Notes that are only a pointer hold nothing for the model to read.
      if (pointer !== null) handled.add(index);
      const url = pointer ?? (phrases ? GUIDE_LINK.exec(section.text)?.[2] ?? null : null);
      if (url !== null) unassessed.push({ section: index, url });
    }
  });
  return { candidates, handled, unassessed };
}
