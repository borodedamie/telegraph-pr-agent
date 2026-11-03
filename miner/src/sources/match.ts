// Matches release tags and changelog headings to package versions (research R5, FR-007).
import semver from "semver";

const VERSION = String.raw`(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)`;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** The version a tag names for this package, or null. Monorepos require the package name in the tag or body. */
export function matchRelease(
  tag: string,
  body: string,
  packageName: string,
  monorepo: boolean
): string | null {
  const name = escape(packageName);
  const shortName = escape(packageName.replace(/^@[^/]+\//, ""));
  const prefixed = new RegExp(`^(?:${name}|${shortName})(?:@|-v|/v|@v)${VERSION}$`);
  const plain = new RegExp(`^v?${VERSION}$`);

  const prefixedMatch = prefixed.exec(tag);
  if (prefixedMatch) return semver.valid(prefixedMatch[1]);
  // A tag naming another package (`other@1.2.3`) is never ours.
  if (/[@/]|-v\d/.test(tag)) return null;

  const plainMatch = plain.exec(tag);
  if (!plainMatch) return null;
  if (monorepo && !new RegExp(`(^|[^\\w@/-])${name}([^\\w-]|$)`).test(body)) return null;
  return semver.valid(plainMatch[1]);
}

export interface ChangelogSection {
  version: string;
  text: string;
}

const HEADING = new RegExp(
  String.raw`^#{1,4}\s+\[?(?:[\w@/.-]+@)?v?` + VERSION + String.raw`\]?(?:\([^)]*\))?(?:\s.*)?$`,
  "gm"
);

/** Splits a changelog into version sections; each section runs from its heading to the next version heading. */
export function splitChangelog(text: string): ChangelogSection[] {
  const headings = [...text.matchAll(HEADING)];
  const sections: ChangelogSection[] = [];
  headings.forEach((heading, i) => {
    const version = semver.valid(heading[1]);
    if (version === null) return;
    const end = i + 1 < headings.length ? headings[i + 1].index : text.length;
    sections.push({ version, text: text.slice(heading.index, end).trimEnd() });
  });
  return sections;
}
