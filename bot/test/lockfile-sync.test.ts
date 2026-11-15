import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSyml } from "@yarnpkg/parsers";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const npm = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const workspace = parseSyml(
  readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8"),
);

describe("bot lockfile consistency", () => {
  it("keeps both lockfiles aligned with the bot's declared dependencies", () => {
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      expect(npm.packages[""][section] ?? {}).toEqual(manifest[section] ?? {});
      const locked = workspace.importers.bot[section] ?? {};
      expect(
        Object.fromEntries(
          Object.entries(locked).map(([name, entry]: [string, any]) => [
            name,
            entry.specifier,
          ]),
        ),
      ).toEqual(manifest[section] ?? {});
      for (const name of Object.keys(manifest[section] ?? {})) {
        expect(locked[name].version.split("(")[0]).toBe(
          npm.packages[npm.packages[`node_modules/${name}`].resolved]
            ?.version ?? npm.packages[`node_modules/${name}`].version,
        );
      }
    }
  });
  it("keeps npm-resolved package versions and integrity hashes in the workspace lock", () => {
    for (const [location, entry] of Object.entries(npm.packages) as [
      string,
      { version?: string; integrity?: string; link?: boolean },
    ][]) {
      if (!location || entry.link) continue;
      const name = location.split("node_modules/").pop();
      const locked = workspace.packages[`${name}@${entry.version}`];
      expect(
        locked,
        `${name}@${entry.version} missing from pnpm-lock.yaml`,
      ).toBeDefined();
      if (entry.integrity)
        expect(locked.resolution.integrity).toBe(entry.integrity);
    }
  });
});
