import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { changedSymbols, findCallSites, renderCallSites } from "../src/call-sites.js";
import type { Finding } from "../src/assessment.js";

const directories: string[] = [];
afterEach(() => { for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });

const repo = (files: Record<string, string>, untracked: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "call-sites-"));
  directories.push(root);
  const write = (entries: Record<string, string>) => {
    for (const [path, content] of Object.entries(entries)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  };
  write(files);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "."]);
  write(untracked);
  return root;
};

const change = (kind: "breaking" | "deprecation" | "security_fix", text: string, quote: string | null = null) =>
  ({ kind, version: "2.0.0", change: text, quote, migration: "Use `newThing()` instead" });
const finding = (changes: ReturnType<typeof change>[], overrides: Partial<Finding> = {}): Finding => ({
  ecosystem: "npm", package: "widget", source: "package.json", currentVersion: "1.0.0", targetVersion: "2.0.0",
  issue: "outdated", reason: "r", cves: [], sources: ["https://example.org/releases"], changes, ...overrides,
});

it("takes code names from breaking changes and deprecations, never from migrations or security fixes", () => {
  expect(changedSymbols(finding([
    change("breaking", "Removed `Widget.render()` and `new Gadget(options)`", "`parse;` is gone"),
    change("deprecation", "`legacyMode` is deprecated; `true` and `widget` are not code names here"),
    change("security_fix", "Fixed `unsafeEval`"),
    change("breaking", "`some phrase with spaces` and `x`"),
  ]))).toEqual(["Widget.render", "Gadget", "parse", "legacyMode"]);
});

it("names the file and line using a deprecated API, only in tracked source files that import the package", () => {
  const root = repo({
    "src/app.ts": 'import { Widget } from "widget";\n\nWidget.render(1);\nconst legacyModeOn = true;\nnotlegacyMode = 1;\n',
    "src/deep.js": "const w = require('widget/sub');\nw.legacyMode = true;\n",
    "src/other.ts": 'import { Widget } from "other-widget";\nWidget.render(2);\n',
    "README.md": "Widget.render is used here\n",
  }, { "src/untracked.ts": 'import "widget";\nWidget.render(3);\n' });
  const sites = findCallSites(root, finding([change("breaking", "Removed `Widget.render()`"), change("deprecation", "`legacyMode` and `absentName`")]));
  expect(sites).toEqual([
    { symbol: "Widget.render", locations: [{ path: "src/app.ts", line: 3 }], more: 0 },
    { symbol: "legacyMode", locations: [{ path: "src/deep.js", line: 2 }], more: 0 },
    { symbol: "absentName", locations: [], more: 0 },
  ]);
});

it("finds members written on their own or at the end of a chain, as zod 4's notes write them", () => {
  // From the zod 3 → 4 fix-stage fixture (borodedamie/telegraph-fix-fixture), which these names missed on 22 Nov.
  const changes = [change("breaking", "drops `.errors`"), change("breaking", "drops `z.string().ip()`"),
    change("breaking", "`z.record()`: drops single argument usage"), change("breaking", "[`e177a0ee`](https://x) docs")];
  const zod = finding(changes, { package: "zod" });
  expect(changedSymbols(zod)).toEqual([".errors", ".ip", "z.record"]);
  const root = repo({ "src/user.ts": [
    'import { z } from "zod";',
    "const ip = z.string().ip({ message: \"Not an IP address\" });",
    "const tags = z.record(z.string());",
    "const v6 = z.ipv6();",
    "type Errors = { errors: string[] };",
    "const list = result.error.errors.map((issue) => issue.message);",
  ].join("\n") });
  expect(findCallSites(root, zod)).toEqual([
    { symbol: ".errors", locations: [{ path: "src/user.ts", line: 6 }], more: 0 },
    { symbol: ".ip", locations: [{ path: "src/user.ts", line: 2 }], more: 0 },
    { symbol: "z.record", locations: [{ path: "src/user.ts", line: 3 }], more: 0 },
  ]);
});

it("finds Python call sites through the import name", () => {
  const root = repo({
    "app/main.py": "from python_widget import client\n\nclient.old_call()\n",
    "app/skip.py": "import other\nother.old_call()\n",
  });
  const sites = findCallSites(root, finding([change("breaking", "Removed `old_call`")],
    { ecosystem: "PyPI", package: "python-widget", source: "requirements.txt" }));
  expect(sites[0].locations).toEqual([{ path: "app/main.py", line: 3 }]);
});

it("caps listed locations and counts the rest", () => {
  const root = repo({ "a.ts": `import "widget";\n${"oldName();\n".repeat(13)}` });
  const [site] = findCallSites(root, finding([change("breaking", "`oldName`")]));
  expect(site.locations).toHaveLength(10);
  expect(site.more).toBe(3);
});

it("renders links pinned to the base commit, the names not found, and a caution", () => {
  const section = renderCallSites(finding([]), [
    { symbol: "Widget.render", locations: [{ path: "src/a b+.ts", line: 3 }], more: 2 },
    { symbol: "absentName", locations: [], more: 0 },
  ], "team/repo", "c".repeat(40));
  expect(section).toContain("### Where this repository uses what changed");
  expect(section).toContain(`- \`Widget.render\`: [\`src/a b+.ts:3\`](https://github.com/team/repo/blob/${"c".repeat(40)}/src/a%20b%2B.ts#L3) and 2 more`);
  expect(section).toContain("Not found: `absentName`.");
  expect(section).toContain("not a type check");
  expect(renderCallSites(finding([]), [{ symbol: "absentName", locations: [], more: 0 }], "team/repo", "c".repeat(40)))
    .toContain("None of the 1 names in the breaking changes and deprecations (`absentName`) appear in tracked files that import widget.");
  expect(renderCallSites(finding([]), [], "team/repo", "c".repeat(40))).toBe("");
});
