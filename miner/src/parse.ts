// Turns a free-form question into a package and requested versions (FR-002). Deterministic, no model.

export type ParseResult =
  | { kind: "ok"; package: string; fromRequested: string | null; toRequested: string }
  | { kind: "needs_clarification"; reason: string }
  | { kind: "out_of_scope"; reason: string };

// Exact versions, partial versions ("18", "4.x") and simple ranges ("^4.1", ">=2.0.0", "~1.2").
const VERSION = /^(?:[\^~]|[<>]=?|=)?v?\d+(?:\.(?:\d+|x|\*)){0,2}(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i;
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const NAME_AT_VERSION = /^(@?[^@\s]+)@(.+)$/;

// Words that sit between a package name and its versions, or that are never a package name.
const FILLER = new Set([
  "a", "an", "and", "the", "of", "in", "on", "for", "at", "from", "to", "into", "vs", "versus", "between",
  "version", "versions", "ver", "v", "release", "releases", "package", "npm", "library", "lib", "module",
  "upgrade", "upgrading", "update", "updating", "bump", "bumping", "migrate", "migrating", "move", "moving",
  "go", "going", "after", "since", "what", "changed", "changes", "change", "breaking", "is", "are", "was",
]);

// Signals that the question is about a package even when no version is named.
const PACKAGE_TALK = /\b(npm|package|upgrade|upgrading|migrat\w*|breaking|changelog|release|version|deprecat\w*)\b/i;

function cleanToken(raw: string): string {
  // Trailing sentence punctuation, and quotes or brackets around a word; a version keeps its inner dots.
  return raw.replace(/^[("'`\[]+/, "").replace(/[)"'`\],;:!?]+$/, "").replace(/\.+$/, "");
}

export function parse(query: string): ParseResult {
  const text = query
    .replace(/\s*(?:→|->|=>|⇒)\s*/g, " to ")
    .replace(/(\d)\.\.(?=v?\d)/g, "$1 to ")
    .trim();
  const tokens = text.split(/\s+/).map(cleanToken).filter((t) => t !== "");

  const versions: { value: string; index: number }[] = [];
  const namedVersions: { name: string; value: string; index: number }[] = [];
  tokens.forEach((token, index) => {
    const at = NAME_AT_VERSION.exec(token);
    if (at && VERSION.test(at[2])) namedVersions.push({ name: at[1].toLowerCase(), value: at[2], index });
    else if (VERSION.test(token) && !isCount(tokens, index)) versions.push({ value: token, index });
  });

  const all = [...namedVersions.map((v) => ({ value: v.value, index: v.index })), ...versions].sort(
    (a, b) => a.index - b.index
  );

  const packageName = findPackage(tokens, namedVersions, all[0]?.index);
  if (packageName === null) {
    if (all.length === 0 && !PACKAGE_TALK.test(text)) {
      return { kind: "out_of_scope", reason: "the question does not name a software package" };
    }
    if (namedVersions.length > 0) {
      return { kind: "needs_clarification", reason: "the question names more than one package" };
    }
    return { kind: "needs_clarification", reason: "name the npm package and the target version" };
  }
  if (all.length === 0) return { kind: "needs_clarification", reason: `name the target version of ${packageName}` };
  if (all.length > 2) return { kind: "needs_clarification", reason: "the question names more than two versions" };

  const before = (index: number) => tokens[index - 1]?.toLowerCase();
  if (all.length === 1) {
    const word = before(all[0].index);
    if (word === "from" || word === "after" || word === "since") {
      return { kind: "needs_clarification", reason: `name the target version of ${packageName}` };
    }
    return { kind: "ok", package: packageName, fromRequested: null, toRequested: stripV(all[0].value) };
  }

  let [from, to] = all;
  // "to 4.0.0 from 3.23.8"
  if (before(from.index) === "to" && before(to.index) === "from") [from, to] = [to, from];
  return { kind: "ok", package: packageName, fromRequested: stripV(from.value), toRequested: stripV(to.value) };
}

// "the 3 breaking changes": a bare integer used as a count, not a version.
const COUNT_BEFORE = new Set(["the", "my", "our", "all", "top", "first", "last", "these", "those", "list"]);
const COUNT_AFTER = new Set(["breaking", "changes", "things", "items", "ways", "major", "biggest", "main"]);

function isCount(tokens: string[], index: number): boolean {
  if (!/^\d+$/.test(tokens[index])) return false;
  return COUNT_BEFORE.has(tokens[index - 1]?.toLowerCase() ?? "") || COUNT_AFTER.has(tokens[index + 1]?.toLowerCase() ?? "");
}

function stripV(version: string): string {
  return version.replace(/^([\^~]|[<>]=?|=)?v/i, "$1");
}

/** The package is the name glued to a version (`zod@4.0.0`), else the nearest real word before the first version. */
function findPackage(
  tokens: string[],
  namedVersions: { name: string }[],
  firstVersionIndex: number | undefined
): string | null {
  if (namedVersions.length > 0) {
    const names = new Set(namedVersions.map((v) => v.name));
    if (names.size > 1 || !NPM_NAME.test(namedVersions[0].name)) return null;
    return namedVersions[0].name;
  }
  if (firstVersionIndex === undefined) return null;
  for (let i = firstVersionIndex - 1; i >= 0; i--) {
    // npm names are lowercase; "React" in prose means the package react.
    const word = tokens[i].toLowerCase();
    if (FILLER.has(word)) continue;
    return NPM_NAME.test(word) && !VERSION.test(word) ? word : null;
  }
  return null;
}
