// GitHub release material: repository identity, releases, changelog and migration guides (research R5, FR-006, FR-007).
import semver from "semver";
import { z } from "zod";
import { canonicalJson } from "../cache.js";
import { pointerLink } from "../extract/rules.js";
import type { CoverageTracker } from "../coverage.js";
import type { Packument } from "../resolve.js";
import { normalizeText } from "../text.js";
import { Timeout, TooLarge, Upstream } from "../safeFetch.js";
import { fetchDocument, isCut, type Retrieval, type SourceDocument } from "./fetch.js";
import { matchRelease, splitChangelog } from "./match.js";
import { editSource, htmlToText, siteGuideLink, siteHostOf } from "./site.js";

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
  // Releases whose notes only point to a changelog or guide: still wanted, so the next steps read that material.
  const pointers: string[] = [];
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
      if (pointerLink(release.body) !== null) pointers.push(version);
      else {
        wanted.delete(version);
        tracker.covered(version);
      }
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

  // The first release of a new major (or 0.y) line: its changelog section and migration guide are read even when
  // the release has notes, since those often only summarise them (express 5.0.0, prettier 3.0.0, mongoose 8.0.0).
  const lineStart = firstOfNewLine(tracker.releases, from);
  const alsoRead = lineStart !== null && tracker.state(lineStart) === "covered" ? lineStart : null;

  // 2. The changelog, package directory first. In each directory the first name that exists is read:
  // express keeps its changelog in History.md.
  const readFromChangelog = (version: string) => wanted.has(version) || version === alsoRead;
  if (wanted.size > 0 || alsoRead !== null) {
    const directories = repo.directory ? [`${repo.directory}/`, ""] : [""];
    const paths = directories.map((dir) => CHANGELOG_NAMES.map((name) => dir + name));
    directory: for (const names of paths) for (const path of names) {
      if (wanted.size === 0 && alsoRead === null) break directory;
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
        continue directory;
      }
      if (document === null) continue;
      // A prerelease section of a wanted release (express's 5.0.0-alpha.1 … 5.0.0-beta.3) shipped in that release.
      const sections = splitChangelog(document.text, packument.name)
        .map((section) => (readFromChangelog(section.version) ? section : { ...section, version: releaseOf(section.version) }))
        .filter((section) => readFromChangelog(section.version));
      if (sections.length === 0) continue directory;
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
      continue directory;
    }
  }

  // 3. A migration guide for the first release of a new major (or 0.y) line: in the repository, else on the
  // package's website when the notes read so far link to one there.
  if (lineStart !== null && (wanted.has(lineStart) || tracker.state(lineStart) === "covered")) {
    let guide: SourceDocument | null;
    try {
      guide = await findMigrationGuide(retrieval, repo, packument.name, lineStart, headers);
      const notes = material.sections.filter((section) => section.version === lineStart).map((section) => section.text);
      guide ??= await findSiteGuide(retrieval, packument.homepage, notes, lineStart);
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

  // Nothing else had them: the pointer is their material, and the answer says what was not assessed.
  for (const version of pointers) {
    if (wanted.delete(version)) tracker.covered(version);
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

const CHANGELOG_NAMES = ["CHANGELOG.md", "History.md", "HISTORY.md", "CHANGES.md"];

/** The release a prerelease ships in (5.0.0-beta.3 → 5.0.0); a release is its own. */
function releaseOf(version: string): string {
  const parsed = semver.parse(version)!;
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/** The first release in range whose breaking-change line (major, or minor for 0.x) differs from "from". */
export function firstOfNewLine(releases: string[], from: string): string | null {
  const line = (v: string) => (semver.major(v) === 0 ? `0.${semver.minor(v)}` : `${semver.major(v)}`);
  return releases.find((v) => semver.prerelease(v) === null && line(v) !== line(from)) ?? null;
}

const TreeResponse = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string().optional() })),
});

// A guide names its topic somewhere in its path: `guides/migrating-to-v5.md`, `upgrading/version-15.mdx`.
const GUIDE_NAME = /(migrat|upgrad|changelog|breaking)[^]*\.mdx?$/i;
// A release post, when the repository has no guide: `website/blog/2023-07-05-3.0.0.md`,
// `blog/2024-07-31-announcing-typescript-eslint-v8.md`.
const BLOG_POST = /\bblog\/[^/]*\.mdx?$/i;
// Where a large repository keeps its documentation, read when its whole tree is over the size cap.
const DOC_DIRS = new Set(["docs", "doc", "documentation", "website", "guides"]);

/**
 * Picks a guide whose path names the new line, e.g. `docs/v4/changelog.mdx` or `guides/migrating-to-v5.md`.
 * Paths naming the package (`react` for @tanstack/react-query) come first, then shorter paths.
 */
export function pickMigrationGuide(paths: string[], version: string, packageName: string): string | null {
  const major = semver.major(version);
  const label = major === 0 ? `0\\.${semver.minor(version)}` : `${major}`;
  // The line as a path part: v5, 5.0, 3.0.0, version-15, migrating_to_8.md; not 3.0.1 or 15.2.
  const names = new RegExp(`(^|[^0-9.])v?${label}(\\.0){0,2}(?=[^0-9.]|\\.mdx?$|$)`, "i");
  // A post must end with the release itself (3.0.0, 3.0, announcing-…-v8): blogs hold posts on other releases
  // of the line, and on its betas, too.
  const release = new RegExp(`(^|[^0-9.])(v${label}|${label}\\.0(\\.0)?)\\.mdx?$`, "i");
  const usable = paths.filter((p) => !/node_modules|\/test|__tests__/.test(p));
  const guides = usable.filter((p) => GUIDE_NAME.test(p) && names.test(p));
  const candidates = guides.length > 0 ? guides : usable.filter((p) => BLOG_POST.test(p) && release.test(p));
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
  const trees = `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees`;
  let paths: string[] | null;
  try {
    paths = await treePaths(retrieval, `${trees}/HEAD?recursive=1`, headers, "");
  } catch (err) {
    if (!(err instanceof TooLarge)) throw err;
    // A very large repository (next.js: 17 MB of paths): read only its documentation directories. Down or
    // over the cap again: the caller decides, as for any optional source.
    const top = await fetchDocument(retrieval, `${trees}/HEAD`, { headers, toText: (body) => canonicalJson(TreeResponse.parse(JSON.parse(body)).tree) });
    if (top === null) return null;
    const entries = z.array(TreeResponse.shape.tree.element).parse(JSON.parse(top.text));
    const dirs = entries.filter((e) => e.type === "tree" && e.sha !== undefined && DOC_DIRS.has(e.path));
    // A monorepo keeps its site in a package: typescript-eslint's packages/website/blog.
    const packagesDir = entries.find((e) => e.type === "tree" && e.path === "packages" && e.sha !== undefined);
    if (packagesDir) {
      const packages = await fetchDocument(retrieval, `${trees}/${packagesDir.sha}`, { headers, toText: (body) => canonicalJson(TreeResponse.parse(JSON.parse(body)).tree) });
      if (packages !== null) {
        for (const entry of z.array(TreeResponse.shape.tree.element).parse(JSON.parse(packages.text))) {
          if (entry.type === "tree" && entry.sha !== undefined && DOC_DIRS.has(entry.path)) dirs.push({ ...entry, path: `packages/${entry.path}` });
        }
      }
    }
    paths = [];
    for (const dir of dirs) paths.push(...((await treePaths(retrieval, `${trees}/${dir.sha}?recursive=1`, headers, `${dir.path}/`)) ?? []));
  }
  if (paths === null) return null;
  const path = pickMigrationGuide(paths, version, packageName);
  if (path === null) return null;
  const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${path}`;
  return fetchDocument(retrieval, url, { toText: normalizeText });
}

const SitePage = z.object({ source: z.string().nullable(), text: z.string() });

/**
 * The guide that the notes link to on the package's website (the host of its npm homepage), or null. The page's
 * "Edit this page" source in its repository is read instead when it has one; else the page's own text. A website
 * shows the guide for its latest release (vite.dev/guide/migration is "Migration from v7" today), so the guide
 * counts only when its opening names this release's line.
 */
async function findSiteGuide(retrieval: Retrieval, homepage: string | null, notes: string[], version: string): Promise<SourceDocument | null> {
  const site = siteHostOf(homepage);
  const link = site === null ? null : siteGuideLink(notes, site);
  if (link === null) return null;
  const page = await fetchDocument(retrieval, link, {
    siteHost: new URL(link).hostname,
    toText: (body) => canonicalJson({ source: editSource(body), text: htmlToText(body) }),
  });
  if (page === null) return null;
  const { source, text } = SitePage.parse(JSON.parse(page.text));
  if (!namesLine(text, version)) {
    console.info(JSON.stringify({ kind: "site_guide_other_release", url: link, version }));
    return null;
  }
  if (source !== null) {
    const raw = await fetchDocument(retrieval, source, { toText: normalizeText });
    if (raw !== null) return raw;
  }
  return { ...page, text };
}

/**
 * Whether a guide's title, or the first line of text under it, names this release's line ("Moving to Express 5",
 * "Upgrading your Tailwind CSS projects from v3 to v4") or the line before it ("Migration from v7" for v8). A
 * passing mention further down ("for v6 & v7") does not count.
 */
export function namesLine(text: string, version: string): boolean {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !/^(---|[a-z]+:\s)/.test(line));
  const title = lines.findIndex((line) => /^#{1,3}\s/.test(line));
  const opening = title === -1 ? lines.slice(0, 2) : [lines[title], lines.slice(title + 1).find((line) => !line.startsWith("#")) ?? ""];
  const major = semver.major(version);
  const minor = semver.minor(version);
  const label = major === 0 ? `0\\.${minor}` : `${major}`;
  const before = major === 0 ? (minor > 0 ? `0\\.${minor - 1}` : null) : `${major - 1}`;
  const line = (l: string) => `(^|[^0-9.])v?${l}(\\.0){0,2}(?![0-9]|\\.[1-9])`;
  const names = new RegExp(line(label), "i");
  const from = before === null ? null : new RegExp(`\\bfrom\\s+(\\S+\\s+){0,3}${line(before)}`, "i");
  // A title with a version in it decides alone: vite's "Migration from v7" is not the v6 guide, whatever follows.
  const said = (/(^|\s)v?\d+(\.\d+)?\b/i.test(opening[0].replace(/^#+\s*/, "")) ? opening[0] : opening.join(" ")).slice(0, 600);
  return names.test(said) || (from !== null && from.test(said));
}

/** The file paths of a tree, each under `prefix`; null when the tree is not there. */
async function treePaths(retrieval: Retrieval, url: string, headers: Record<string, string>, prefix: string): Promise<string[] | null> {
  const tree = await fetchDocument(retrieval, url, {
    headers,
    // Only the file paths are kept.
    toText: (body) =>
      canonicalJson(
        TreeResponse.parse(JSON.parse(body))
          .tree.filter((entry) => entry.type === "blob")
          .map((entry) => entry.path)
      ),
  });
  return tree === null ? null : z.array(z.string()).parse(JSON.parse(tree.text)).map((path) => prefix + path);
}
