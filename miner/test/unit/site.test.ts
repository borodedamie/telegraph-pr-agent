import { describe, expect, it } from "vitest";
import { extractRules } from "../../src/extract/rules.js";
import { namesLine } from "../../src/sources/github.js";
import { editSource, htmlToText, siteGuideLink, siteHostOf } from "../../src/sources/site.js";

describe("package website guides", () => {
  it("takes the website host from the npm homepage, but not the repository or the registry", () => {
    expect(siteHostOf("http://expressjs.com/")).toBe("expressjs.com");
    expect(siteHostOf("https://tailwindcss.com")).toBe("tailwindcss.com");
    expect(siteHostOf("https://github.com/sindresorhus/chalk#readme")).toBeNull();
    expect(siteHostOf("https://www.npmjs.com/package/x")).toBeNull();
    expect(siteHostOf("not a url")).toBeNull();
    expect(siteHostOf(null)).toBeNull();
  });

  it("picks a migration guide on the website host over its blog post, and ignores other hosts", () => {
    const notes = [
      "Read the [announcement](https://tailwindcss.com/blog/tailwindcss-v4) and https://evil.example/upgrade-guide.",
      "See the [upgrade guide](https://tailwindcss.com/docs/upgrade-guide#changes-from-v3).",
    ];
    expect(siteGuideLink(notes, "tailwindcss.com")).toBe("https://tailwindcss.com/docs/upgrade-guide");
    expect(siteGuideLink(["https://www.tailwindcss.com/docs/upgrade-guide"], "tailwindcss.com")).toBe("https://www.tailwindcss.com/docs/upgrade-guide");
    expect(siteGuideLink(["https://tailwindcss.com/pricing"], "tailwindcss.com")).toBeNull();
    expect(siteGuideLink(notes, "expressjs.com")).toBeNull();
  });

  it("reads a page's Edit link as its raw source, with ./ and ../ resolved", () => {
    expect(editSource('<a href="https://github.com/expressjs/expressjs.com/edit/main/src/content/pages/en/guide/migrating-5.mdx">Edit</a>')).toBe(
      "https://raw.githubusercontent.com/expressjs/expressjs.com/main/src/content/pages/en/guide/migrating-5.mdx"
    );
    expect(editSource('<a href="https://github.com/babel/website/edit/main/docs/../docs/v8-migration-api.md">')).toBe(
      "https://raw.githubusercontent.com/babel/website/main/docs/v8-migration-api.md"
    );
    // A link to some other file in a repository is not the page's source.
    expect(editSource('<a href="https://github.com/prettier/prettier/blob/main/commands.md">')).toBeNull();
  });

  it("turns a guide page into headings and list items, leaving navigation and scripts out", () => {
    const html = [
      "<html><body><nav><a>Docs</a><h2>Menu</h2></nav><main>",
      "<h1>Upgrade guide</h1><p>Upgrading your projects from v3 to v4.</p>",
      "<h2>Changes from v3</h2><h3>Removed <code>@tailwind</code> directives</h3>",
      "<p>Use <code>@import</code> instead &amp; enjoy.</p><ul><li>one</li><li>two</li></ul>",
      "<pre><code>@tailwind base;\n@tailwind components;</code></pre><script>alert(1)</script>",
      "</main><footer>© us</footer></body></html>",
    ].join("");
    expect(htmlToText(html)).toBe(
      [
        "# Upgrade guide",
        "Upgrading your projects from v3 to v4.",
        "## Changes from v3",
        "### Removed @tailwind directives",
        "Use @import instead & enjoy.",
        "- one\n- two",
        "```\n@tailwind base;\n@tailwind components;\n```",
      ].join("\n\n")
    );
  });

  it("stays fast on a long page of unclosed tags", () => {
    const html = "<div ".repeat(50_000) + "<script>" + "x".repeat(100_000);
    const started = Date.now();
    htmlToText(html);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("takes a website guide only when its title or opening names the release's line", () => {
    expect(namesLine("# Migration from v7\n\nIf you are migrating from rolldown-vite, for v6 & v7, ...", "6.0.0")).toBe(false);
    expect(namesLine("# Migration from v7\n\nIf you are migrating ...", "8.0.0")).toBe(true);
    expect(namesLine("# Upgrade guide\nUpgrading your Tailwind CSS projects from v3 to v4.", "4.0.0")).toBe(true);
    expect(namesLine("---\ntitle: x\n---\n# Moving to Express 5\nExpress 5 is not very different.", "5.0.0")).toBe(true);
    expect(namesLine("# Moving to Express 5\n", "4.0.0")).toBe(false);
    expect(namesLine("# React 19.1 notes\n", "19.0.0")).toBe(false);
  });

  it("reads the innermost headings of a guide's change sections, and only those", () => {
    const text = [
      "# Moving to Express 5",
      "## Installation",
      "## Removed methods and properties",
      "### app.del()",
      "#### How to update",
      "Use `app.delete()` instead.",
      "## Breaking Changes",
      "### JavaScript",
      "#### Change the default value for `trailingComma` to `all`",
      "## Other Changes",
      "#### Remove unnecessary parentheses",
    ].join("\n");
    const { candidates } = extractRules([{ version: "5.0.0", consulted: 0, text }], () => "migration_guide");
    expect(candidates.map((c) => [c.kind, c.excerpt, c.migration])).toEqual([
      ["breaking", "app.del()", "Use `app.delete()` instead."],
      ["breaking", "Change the default value for `trailingComma` to `all`", null],
    ]);
  });
});
