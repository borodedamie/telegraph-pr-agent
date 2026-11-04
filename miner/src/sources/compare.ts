// Tag comparison, the last-resort source (research R5): changed code as repository evidence.
import { z } from "zod";
import { canonicalJson } from "../cache.js";
import type { CoverageTracker } from "../coverage.js";
import { normalizeText } from "../text.js";
import { TooLarge } from "../safeFetch.js";
import { fetchDocument, isCut, type Retrieval, type SourceDocument } from "./fetch.js";
import type { Consulted, Material, RepoIdentity, Section } from "./github.js";

// GitHub's own limits on one comparison.
const MAX_COMMITS = 250;
const MAX_FILES = 300;
/** Patch text kept per comparison; the rest is cut and the releases are marked truncated. */
export const MAX_PATCH_CHARS = 12_000;

const RawCompare = z.object({
  total_commits: z.number().optional(),
  commits: z.array(z.unknown()).default([]),
  files: z
    .array(z.object({ filename: z.string(), status: z.string().optional(), patch: z.string().optional() }))
    .default([]),
});

const ReducedCompare = z.object({
  truncated: z.boolean(),
  files: z.array(z.object({ filename: z.string(), patch: z.string() })),
});
type ReducedCompare = z.infer<typeof ReducedCompare>;

const TEST_PATH = /(^|\/)(test|tests|__tests__|spec|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** Lower is more important: type declarations, then package.json, then entry points, then other source. */
function priority(filename: string): number {
  if (/\.d\.[cm]?ts$/.test(filename)) return 0;
  if (/(^|\/)package\.json$/.test(filename)) return 1;
  if (/(^|\/)(index|main)\.[cm]?[jt]sx?$/.test(filename)) return 2;
  return 3;
}

/** Keeps only patches under the package directory, outside tests, most important first. */
export function reduceCompare(body: string, directory: string | null): string {
  const raw = RawCompare.parse(JSON.parse(body));
  const prefix = directory ? `${directory}/` : "";
  const kept = raw.files
    .filter((f) => f.filename.startsWith(prefix) && !TEST_PATH.test(f.filename) && f.patch !== undefined)
    .map((f) => ({ filename: f.filename, patch: normalizeText(f.patch!) }))
    .sort((a, b) => priority(a.filename) - priority(b.filename) || (a.filename < b.filename ? -1 : 1));
  const truncated =
    raw.commits.length >= MAX_COMMITS ||
    (raw.total_commits !== undefined && raw.total_commits > raw.commits.length) ||
    raw.files.length >= MAX_FILES ||
    raw.files.some((f) => f.filename.startsWith(prefix) && f.patch === undefined);
  return canonicalJson({ truncated, files: kept });
}

/** The section text: each kept patch under its file name, cut at MAX_PATCH_CHARS. */
export function compareSectionText(compare: ReducedCompare): { text: string; cut: boolean } {
  let text = "";
  for (const file of compare.files) {
    const block = `--- ${file.filename}\n${file.patch}\n`;
    if (text.length + block.length > MAX_PATCH_CHARS) return { text, cut: true };
    text += block;
  }
  return { text, cut: false };
}

/** Consecutive releases that still lack material, each compared as one range from the release before it. */
export function missingRuns(releases: string[], missing: Set<string>): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const version of releases) {
    if (missing.has(version)) run.push(version);
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * Compares tags for releases still without material. `tagFor` gives the tag name pattern this repository uses.
 * Items found here are repository evidence; a grouped range is attributed to its last release.
 */
export async function retrieveComparisons(
  retrieval: Retrieval,
  repo: RepoIdentity,
  from: string,
  tracker: CoverageTracker,
  tagFor: (version: string) => string,
  headers: Record<string, string>
): Promise<Material> {
  const material: Material = { consulted: [], sections: [] };
  const missing = new Set(tracker.missing());
  for (const run of missingRuns(tracker.releases, missing)) {
    const index = tracker.releases.indexOf(run[0]);
    const base = index > 0 ? tracker.releases[index - 1] : from;
    const head = run[run.length - 1];
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(tagFor(base))}...${encodeURIComponent(tagFor(head))}`;
    let document: SourceDocument | null;
    try {
      document = await fetchDocument(retrieval, url, {
        headers,
        // The stored text is filtered to the package directory, so packages sharing tags need their own manifest.
        manifestId: `${url}#${repo.directory ?? ""}`,
        toText: (body) => reduceCompare(body, repo.directory),
      });
    } catch (err) {
      // Out of budget or time: keep the comparisons already read; the remaining releases stay missing.
      if (isCut(err, retrieval) && material.consulted.length > 0) return material;
      // A comparison over the size cap cannot be read in full: its releases are truncated, not failed.
      if (!(err instanceof TooLarge)) throw err;
      console.warn(JSON.stringify({ kind: "compare_skipped", url, error: String(err) }));
      for (const version of run) tracker.notCovered(version, "truncated");
      continue;
    }
    if (document === null) continue; // A tag is missing: these releases stay without material.

    const compare = ReducedCompare.parse(JSON.parse(document.text));
    const { text, cut } = compareSectionText(compare);
    const consulted: Consulted = {
      type: "tag_compare",
      url: `https://github.com/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(tagFor(base))}...${encodeURIComponent(tagFor(head))}`,
      document,
      versionFrom: base,
      versionTo: head,
      trust: "repository_evidence",
    };
    material.consulted.push(consulted);
    if (compare.truncated || cut) {
      for (const version of run) tracker.notCovered(version, "truncated");
    }
    if (text !== "") {
      const section: Section = { version: head, consulted: material.consulted.length - 1, text };
      material.sections.push(section);
    }
    // Releases in a complete comparison are covered even when no relevant file changed.
    if (!compare.truncated && !cut) for (const version of run) tracker.covered(version);
  }
  return material;
}
