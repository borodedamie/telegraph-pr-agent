// Recorded upstream responses (test/fixtures/), served by URL.
import { readFileSync } from "node:fs";
import type { SafeResponse } from "../src/safeFetch.js";

export function fixtureFetcher(files: Record<string, string>) {
  const urls: string[] = [];
  const fetcher = async (url: string): Promise<SafeResponse> => {
    urls.push(url);
    const file = files[url];
    if (file === undefined) return { status: 404, url, headers: {}, body: "", notModified: false };
    return { status: 200, url, headers: {}, body: readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"), notModified: false };
  };
  return { fetcher, urls };
}

export const ZOD_GITHUB = {
  "https://api.github.com/repos/colinhacks/zod/releases?per_page=100&page=1": "github/zod.releases.1.json",
  "https://api.github.com/repos/colinhacks/zod/releases?per_page=100&page=2": "github/zod.releases.2.json",
  "https://api.github.com/repos/colinhacks/zod/git/trees/HEAD?recursive=1": "github/zod.tree.json",
  "https://raw.githubusercontent.com/colinhacks/zod/HEAD/packages/docs/content/v4/changelog.mdx": "github/zod.v4-changelog.mdx",
};
