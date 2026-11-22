import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./assessment.js";

const MAX_SYMBOLS = 20;
const MAX_LOCATIONS = 10;
const MAX_FILE_BYTES = 1024 * 1024;

const SOURCE_FILES: Record<Finding["ecosystem"], RegExp> = {
  npm: /\.(?:[cm]?[jt]sx?|vue|svelte)$/,
  PyPI: /\.pyi?$/,
};

// Words a release note may put in backticks that say nothing about this repository's code.
const NOT_SYMBOLS = new Set(
  "true false null undefined None True False import require export default async await function class const let var return new this self from type".split(
    " ",
  ),
);

export interface CallSite {
  symbol: string;
  locations: { path: string; line: number }[];
  /** Matches beyond the listed locations. */
  more: number;
}

/**
 * Code names a breaking change or deprecation mentions in backticks, e.g. `Buffer.from()`. A member
 * written on its own (`.errors`) or at the end of a chain (`z.string().ip()`) is kept as `.errors`
 * or `.ip`: the member is what changed, and it is searched for after a dot.
 * Miner text is untrusted: a name is only ever used as a literal search string, never a regex or command.
 */
export const changedSymbols = (finding: Finding): string[] => {
  const symbols = new Set<string>();
  for (const change of finding.changes ?? []) {
    if (change.kind === "security_fix") continue;
    for (const [, span] of `${change.change} ${change.quote ?? ""}`.matchAll(/`([^`\n]{1,80})`/g)) {
      const name = span
        .trim()
        .replace(/^new\s+/, "")
        .replace(/;$/, "")
        .replace(/^.*\)(?=\.)/, "")
        .replace(/\(.*\)$/, "");
      if (
        /^\.?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(name) &&
        name.length >= 3 &&
        !NOT_SYMBOLS.has(name.replace(/^\./, "")) &&
        // A commit hash in backticks ("`e177a0ee`") is not code.
        !/^[0-9a-f]{7,40}$/.test(name) &&
        name !== finding.package
      )
        symbols.add(name);
    }
  }
  return [...symbols].slice(0, MAX_SYMBOLS);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const importsPackage = (text: string, finding: Finding): boolean => {
  if (finding.ecosystem === "npm")
    return ["'", '"', "`"].some(
      (quote) => text.includes(`${quote}${finding.package}${quote}`) || text.includes(`${quote}${finding.package}/`),
    );
  // ponytail: the import name is assumed to be the distribution name with "-" as "_"; packages
  // imported under another name (protobuf → google.protobuf) are missed until we map them.
  const module = finding.package.toLowerCase().replace(/[-.]/g, "_");
  return new RegExp(`^\\s*(?:from|import)\\s+${escapeRegExp(module)}\\b`, "m").test(text);
};

/** Where the repository's tracked source files that import the package use each changed name. */
export const findCallSites = (root: string, finding: Finding): CallSite[] => {
  const symbols = changedSymbols(finding);
  if (!symbols.length) return [];
  const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\0")
    // ponytail: unusual paths are skipped so a file name can never break the PR's markdown.
    .filter((path) => SOURCE_FILES[finding.ecosystem].test(path) && /^[\w./@+-]+$/.test(path));
  const sites = symbols.map((symbol) => ({
    symbol,
    // A member (`.errors`) follows any name ("result.error.errors"); a plain name starts a word.
    pattern: new RegExp(`${symbol.startsWith(".") ? "" : "(?<![\\w$])"}${escapeRegExp(symbol)}(?![\\w$])`),
    locations: [] as CallSite["locations"],
    more: 0,
  }));
  for (const path of files) {
    const absolute = join(root, path);
    const stat = statSync(absolute, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) continue;
    const text = readFileSync(absolute, "utf8");
    if (text.includes("\0") || !importsPackage(text, finding)) continue;
    const lines = text.split("\n");
    for (const site of sites)
      lines.forEach((line, index) => {
        if (!site.pattern.test(line)) return;
        if (site.locations.length < MAX_LOCATIONS) site.locations.push({ path, line: index + 1 });
        else site.more++;
      });
  }
  return sites.map(({ symbol, locations, more }) => ({ symbol, locations, more }));
};

/** The "where this repository uses it" section; empty when the changes name no code. */
export const renderCallSites = (
  finding: Finding,
  sites: CallSite[],
  repository: string,
  baseSha: string,
): string => {
  if (!sites.length) return "";
  const used = sites.filter((site) => site.locations.length);
  const lines = [`### Where this repository uses what changed`, ""];
  if (!used.length) {
    lines.push(
      `None of the ${sites.length} names in the breaking changes and deprecations (${sites.map((site) => `\`${site.symbol}\``).join(", ")}) appear in tracked files that import ${finding.package}.`,
    );
  } else {
    for (const site of used) {
      const links = site.locations.map(
        ({ path, line }) =>
          `[\`${path}:${line}\`](https://github.com/${repository}/blob/${baseSha}/${path.split("/").map(encodeURIComponent).join("/")}#L${line})`,
      );
      lines.push(`- \`${site.symbol}\`: ${links.join(", ")}${site.more ? ` and ${site.more} more` : ""}`);
    }
    const unused = sites.filter((site) => !site.locations.length);
    if (unused.length)
      lines.push("", `Not found: ${unused.map((site) => `\`${site.symbol}\``).join(", ")}.`);
  }
  lines.push(
    "",
    "_A text search for names quoted in the release notes, not a type check: review each match, and don't read an empty list as proof the upgrade is safe._",
  );
  return `${lines.join("\n")}\n\n`;
};
