// GitHub release material: repository identity, releases, changelog and migration guides (research R5, FR-006, FR-007).
import semver from "semver";
import { z } from "zod";
import { canonicalJson } from "../cache.js";
import type { CoverageTracker } from "../coverage.js";
import type { Packument } from "../resolve.js";
import { normalizeText } from "../text.js";
import { Timeout, TooLarge, Upstream } from "../safeFetch.js";
import { fetchDocument, isCut, type Retrieval, type SourceDocument } from "./fetch.js";
import { matchRelease, splitChangelog } from "./match.js";

export interface RepoIdentity {
  owner: string;
  repo: string;
  /** Package directory in a monorepo, without leading or trailing slashes. */
  directory: string | null;
}

const GITHUB_URL = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+))?\/?$/;

/** Reads the registry `repository` field. Only GitHub repositories are supported. */
export function repoIdentity(repository: Packument["repository"]): RepoIdentity | { reason: string } {
  if (repository === null) return { reason: "the registry names no repository" };
  const url = typeof repository === "string" ? repository : repository.url ?? "";
  const directoryField = typeof repository === "string" ? undefined : repository.directory;

  const shorthand = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url);
  const match = shorthand ?? GITHUB_URL.exec(url);
  if (!match) return { reason: `the repository is not on GitHub: ${url || "(empty)"}` };
  const directory = (directoryField ?? (shorthand ? undefined : match[3]) ?? "").replace(/^\/+|\/+$/g, "");
  return { owner: match[1], repo: match[2], directory: directory === "" ? null : directory };
}

/** One document the answer consulted, before source ids are assigned. */
export interface Consulted {
  type: "release" | "changelog" | "migration_guide" | "tag_compare";
  url: string;
  document: SourceDocument;
  versionFrom: string | null;
  versionTo: string | null;
  trust: "official" | "repository_evidence";
}

/** Version-specific text derived from a consulted document; `consulted` indexes the consulted list. */
export interface Section {
  version: string;
  consulted: number;
  text: string;
}

export interface Material {
  consulted: Consulted[];
  sections: Section[];
  /** How this repository names release tags, learned from a matched release, e.g. `v{v}` or `zod@{v}`. */
  tagTemplate?: string;
  /** An optional source (changelog, migration guide) was down; the answer goes on without it. */
  optionalSourceFailed?: boolean;
  /** Releases whose source was over its size cap and left out; they are truncated unless a later step covers them. */
  tooLargeFor?: string[];
}

export function githubHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

const RawRelease = z.object({
  tag_name: z.string(),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  html_url: z.string(),
  draft: z.boolean().optional(),
  published_at: z.string().nullable().optional(),
});
const ReducedRelease = z.object({
  tag: z.string(),
  body: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
});
type ReducedRelease = z.infer<typeof ReducedRelease>;

export function reduceReleases(body: string): string {
  const releases = z.array(RawRelease).parse(JSON.parse(body));
  return canonicalJson(
    releases
      .filter((r) => !r.draft)
      .map((r) => ({ tag: r.tag_name, body: normalizeText(r.body ?? ""), url: r.html_url, publishedAt: r.published_at ?? null }))
  );
}

const PER_PAGE = 100;
const MAX_RELEASE_PAGES = 10;

/**
 * Finds material for every release the tracker still misses, in FR-006 order: GitHub releases, then CHANGELOG.md
 * (package directory first, then the root), then a migration guide for a major upgrade.
 */
export async function retrieveReleaseNotes(
  retrieval: Retrieval,
  repo: RepoIdentity,
  packument: Packument,
  from: string,
  tracker: CoverageTracker,
  env: NodeJS.ProcessEnv
): Promise<Material> {
  const material: Material = { consulted: [], sections: [] };
  const headers = githubHeaders(env);
  const monorepo = repo.directory !== null;
  const wanted = new Set(tracker.missing());
  const previous = (version: string) => {
    const index = tracker.releases.indexOf(version);
    return index > 0 ? tracker.releases[index - 1] : from;
  };

  // 1. Releases, newest first; stop once a page reaches releases published before the "from" version.
  const fromTime = Date.parse(packument.time[from] ?? "");
  for (let page = 1; page <= MAX_RELEASE_PAGES && wanted.size > 0; page++) {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=${PER_PAGE}&page=${page}`;
    let document: SourceDocument | null;
    try {
      document = await fetchDocument(retrieval, url, { headers, toText: reduceReleases });
    } catch (err) {
      // Out of budget or time on a later page: keep the pages already read; the next step meets the same cut.
      if (page > 1 && isCut(err, retrieval)) return material;
      throw err;
    }
    if (document === null) break;
    const releases = z.array(ReducedRelease).parse(JSON.parse(document.text));
    for (const release of releases) {
      const version = matchRelease(release.tag, release.body, packument.name, monorepo);
      if (version === null || !wanted.has(version) || release.body.trim() === "") continue;
      wanted.delete(version);
      tracker.covered(version);
      material.tagTemplate ??= release.tag.replace(version, "{v}");
      material.consulted.push({
        type: "release",
        url: release.url,
        document,
        versionFrom: previous(version),
        versionTo: version,
        trust: "official",
      });
      material.sections.push({ version, consulted: material.consulted.length - 1, text: release.body });
    }
    const oldest = releases.at(-1)?.publishedAt;
    if (releases.length < PER_PAGE || (oldest && Date.parse(oldest) < fromTime)) break;
  }

  // 2. CHANGELOG.md, package directory first.
  if (wanted.size > 0) {
    const paths = repo.directory ? [`${repo.directory}/CHANGELOG.md`, "CHANGELOG.md"] : ["CHANGELOG.md"];
    for (const path of paths) {
      if (wanted.size === 0) break;
      const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${path}`;
      let document: SourceDocument | null;
      try {
        document = await fetchDocument(retrieval, url, { toText: normalizeText });
      } catch (err) {
        // A changelog over the size cap or down is left out; later steps may still cover its releases.
        const failure = optionalFailure(err, retrieval);
        if (failure === null) throw err;
        console.warn(JSON.stringify({ kind: "changelog_skipped", url, failure, error: String(err) }));
        // Out of budget or time: keep the release notes already read; the next step meets the same cut.
        if (failure === "cut") return material;
        if (failure === "down") material.optionalSourceFailed = true;
        if (failure === "too_large") (material.tooLargeFor ??= []).push(...wanted);
        continue;
      }
      if (document === null) continue;
      const sections = splitChangelog(document.text, packument.name).filter((s) => wanted.has(s.version));
      if (sections.length === 0) continue;
      const versions = sections.map((s) => s.version).sort(semver.compare);
      material.consulted.push({
        type: "changelog",
        url,
        document,
        versionFrom: previous(versions[0]),
        versionTo: versions[versions.length - 1],
        trust: "official",
      });
      for (const section of sections) {
        wanted.delete(section.version);
        tracker.covered(section.version);
        material.sections.push({ version: section.version, consulted: material.consulted.length - 1, text: section.text });
      }
    }
  }

  // 3. A migration guide in the repository, for the first release of a new major (or 0.y) line.
  const lineStart = firstOfNewLine(tracker.releases, from);
  if (lineStart !== null && wanted.has(lineStart)) {
    let guide: SourceDocument | null;
    try {
      guide = await findMigrationGuide(retrieval, repo, packument.name, lineStart, headers);
    } catch (err) {
      const failure = optionalFailure(err, retrieval);
      if (failure === null) throw err;
      console.warn(JSON.stringify({ kind: "migration_guide_skipped", failure, error: String(err) }));
      if (failure === "down") material.optionalSourceFailed = true;
      if (failure === "too_large") (material.tooLargeFor ??= []).push(lineStart);
      guide = null;
    }
    if (guide !== null) {
      wanted.delete(lineStart);
      tracker.covered(lineStart);
      material.consulted.push({
        type: "migration_guide",
        url: guide.url,
        document: guide,
        versionFrom: previous(lineStart),
        versionTo: lineStart,
        trust: "official",
      });
      material.sections.push({ version: lineStart, consulted: material.consulted.length - 1, text: guide.text });
    }
  }

  return material;
}

/**
 * Why an optional source (changelog, migration guide) could not be read, or null for an error that is a bug:
 * over the size cap, down (an upstream outage), or cut by the answer's own budget or deadline.
 */
function optionalFailure(err: unknown, retrieval: Retrieval): "too_large" | "down" | "cut" | null {
  if (err instanceof TooLarge) return "too_large";
  if (isCut(err, retrieval)) return "cut";
  if (err instanceof Upstream || err instanceof Timeout) return "down";
  return null;
}

/** The first release in range whose breaking-change line (major, or minor for 0.x) differs from "from". */
export function firstOfNewLine(releases: string[], from: string): string | null {
  const line = (v: string) => (semver.major(v) === 0 ? `0.${semver.minor(v)}` : `${semver.major(v)}`);
  return releases.find((v) => semver.prerelease(v) === null && line(v) !== line(from)) ?? null;
}

const TreeResponse = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
});

const GUIDE_NAME = /(migrat|upgrad|changelog|breaking)[^/]*\.mdx?$/i;

/**
 * Picks a guide whose path names the new line, e.g. `docs/v4/changelog.mdx` or `guides/migrating-to-v5.md`.
 * Paths naming the package (`react` for @tanstack/react-query) come first, then shorter paths.
 */
export function pickMigrationGuide(paths: string[], version: string, packageName: string): string | null {
  const major = semver.major(version);
  const label = major === 0 ? `0\\.${semver.minor(version)}` : `${major}`;
  const names = new RegExp(`(^|[^0-9.])(v${label}|${label}\\.0|version-${label})([^0-9]|$)`, "i");
  const candidates = paths.filter((p) => GUIDE_NAME.test(p) && names.test(p) && !/node_modules|\/test|__tests__/.test(p));
  const words = packageName.replace(/^@[^/]+\//, "").split(/[^a-z0-9]+/i).filter((w) => w.length > 1);
  const named = (path: string) => words.filter((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`, "i").test(path)).length;
  candidates.sort((a, b) => named(b) - named(a) || a.length - b.length || (a < b ? -1 : 1));
  return candidates[0] ?? null;
}

async function findMigrationGuide(
  retrieval: Retrieval,
  repo: RepoIdentity,
  packageName: string,
  version: string,
  headers: Record<string, string>
): Promise<SourceDocument | null> {
  const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/HEAD?recursive=1`;
  // Over the size cap (a very large repository) or down: the caller decides, as for any optional source.
  const tree = await fetchDocument(retrieval, treeUrl, {
    headers,
    // Only the file paths are kept.
    toText: (body) =>
      canonicalJson(
        TreeResponse.parse(JSON.parse(body))
          .tree.filter((entry) => entry.type === "blob")
          .map((entry) => entry.path)
      ),
  });
  if (tree === null) return null;
  const path = pickMigrationGuide(z.array(z.string()).parse(JSON.parse(tree.text)), version, packageName);
  if (path === null) return null;
  const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${path}`;
  return fetchDocument(retrieval, url, { toText: normalizeText });
}
