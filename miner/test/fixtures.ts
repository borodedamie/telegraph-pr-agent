// Recorded upstream responses (test/fixtures/), served by URL.
import { readFileSync } from "node:fs";
import type { SafeResponse } from "../src/safeFetch.js";
import { OSV_QUERY_URL } from "../src/sources/osv.js";

/** An OSV query is a POST to one URL: its fixture is keyed `<url>#<package>@<version>`, or the URL alone for any query. */
function osvKey(url: string, body: string | undefined): string | null {
  if (url !== OSV_QUERY_URL || body === undefined) return null;
  const query = JSON.parse(body) as { package: { name: string }; version: string; page_token?: string };
  return `${url}#${query.package.name}@${query.version}${query.page_token ? `#${query.page_token}` : ""}`;
}

export function fixtureFetcher(files: Record<string, string>) {
  const urls: string[] = [];
  const fetcher = async (url: string, options: { body?: string } = {}): Promise<SafeResponse> => {
    urls.push(url);
    const key = osvKey(url, options.body);
    const file = (key !== null ? files[key] : undefined) ?? files[url];
    if (file === undefined) return { status: 404, url, headers: {}, body: "", notModified: false };
    return { status: 200, url, headers: {}, body: readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"), notModified: false };
  };
  return { fetcher, urls };
}

/** No known advisories for any query. */
export const OSV_NONE = { [OSV_QUERY_URL]: "osv/empty.json" };

export const ZOD_OSV = {
  [`${OSV_QUERY_URL}#zod@3.23.8`]: "osv/zod@3.23.8.json",
  [`${OSV_QUERY_URL}#zod@4.0.0`]: "osv/zod@4.0.0.json",
};

export const ZOD_GITHUB = {
  "https://api.github.com/repos/colinhacks/zod/releases?per_page=100&page=1": "github/zod.releases.1.json",
  "https://api.github.com/repos/colinhacks/zod/releases?per_page=100&page=2": "github/zod.releases.2.json",
  "https://api.github.com/repos/colinhacks/zod/git/trees/HEAD?recursive=1": "github/zod.tree.json",
  "https://raw.githubusercontent.com/colinhacks/zod/HEAD/packages/docs/content/v4/changelog.mdx": "github/zod.v4-changelog.mdx",
};

/** got 8.0.2 → 11.0.0: 40 releases over three majors; 8.0.3 has no GitHub release, only its tag compare. */
export const GOT_MULTI = {
  "https://registry.npmjs.org/got": "multi/got.npm.json",
  [`${OSV_QUERY_URL}#got@8.0.2`]: "multi/got.osv@8.0.2.json",
  [`${OSV_QUERY_URL}#got@11.0.0`]: "multi/got.osv@11.0.0.json",
  "https://api.github.com/repos/sindresorhus/got/releases?per_page=100&page=1": "multi/got.releases.1.json",
  "https://api.github.com/repos/sindresorhus/got/releases?per_page=100&page=2": "multi/got.releases.2.json",
  "https://api.github.com/repos/sindresorhus/got/git/trees/HEAD?recursive=1": "multi/got.tree.json",
  "https://api.github.com/repos/sindresorhus/got/compare/v8.0.2...v8.0.3": "multi/got.compare.v8.0.2...v8.0.3.json",
};
