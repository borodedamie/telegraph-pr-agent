import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lockedVersions, readPackageLock } from "../src/lockfiles.js";
import { scanRepository } from "../src/scan.js";
import { prepareUpdate, updateManifest } from "../src/updates.js";
import { createDependencyPr } from "../src/pull-request.js";

const directories: string[] = [];
const directory = () => {
  const root = mkdtempSync(join(tmpdir(), "action-lock-test-"));
  directories.push(root);
  return root;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of directories.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const manifest = {
  dependencies: { zod: "^3.23.0" },
  devDependencies: { "@scope/pkg": "~1.0.0" },
};
const finding = {
  ecosystem: "npm" as const,
  package: "zod",
  source: "package.json",
  currentVersion: "3.23.8",
  targetVersion: "4.0.0",
  issue: "outdated" as const,
  reason: "New release",
  cves: [],
  sources: ["https://example.org/release"],
};
const formats = [
  {
    manager: "pnpm",
    version: "8.15.9",
    filename: "pnpm-lock.yaml",
    format: "pnpm6",
  },
  {
    manager: "pnpm",
    version: "10.18.3",
    filename: "pnpm-lock.yaml",
    format: "pnpm9",
  },
  {
    manager: "yarn",
    version: "1.22.22",
    filename: "yarn.lock",
    format: "classic",
  },
  {
    manager: "yarn",
    version: "4.9.2",
    filename: "yarn.lock",
    format: "modern",
  },
  { manager: "bun", version: "1.3.3", filename: "bun.lock", format: "bun" },
];
const lockText = (format: string, version = "3.23.8", range = "^3.23.0") => {
  const declarations = {
    dependencies: { zod: range },
    devDependencies: manifest.devDependencies,
  };
  if (format.startsWith("pnpm")) {
    const importer = {
      dependencies: {
        zod: { specifier: range, version: `${version}(@scope/pkg@1.0.0)` },
      },
      devDependencies: {
        "@scope/pkg": { specifier: "~1.0.0", version: "1.0.0" },
      },
    };
    const packages = Object.fromEntries(
      [`zod@${version}`, "@scope/pkg@1.0.0"].map((key) => [
        format === "pnpm6" ? `/${key}` : key,
        { resolution: { integrity: "sha512-example" } },
      ]),
    );
    return JSON.stringify({
      lockfileVersion: format === "pnpm6" ? "6.0" : "9.0",
      ...(format === "pnpm6" ? importer : { importers: { ".": importer } }),
      packages,
    });
  }
  if (format === "bun")
    return `// Bun permits comments and trailing commas\n${JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: { "": declarations },
        packages: {
          zod: [`zod@${version}`, "", {}, "sha512-example"],
          "@scope/pkg": ["@scope/pkg@1.0.0", "", {}, "sha512-example"],
        },
      },
      null,
      2,
    ).replace(/\n}$/, ",\n}")}`;
  if (format === "modern")
    return JSON.stringify({
      __metadata: { version: 8, cacheKey: "10c0" },
      [`zod@npm:${range}`]: { version, resolution: `zod@npm:${version}` },
      "@scope/pkg@npm:~1.0.0": {
        version: "1.0.0",
        resolution: "@scope/pkg@npm:1.0.0",
      },
    });
  return `# yarn lockfile v1\n\n"zod@${range}, zod@${version}":\n  version "${version}"\n  resolved "https://registry.yarnpkg.com/zod/-/zod-${version}.tgz"\n\n"@scope/pkg@~1.0.0":\n  version "1.0.0"\n  resolved "https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz"\n`;
};
const fixture = (format: (typeof formats)[number]) => {
  const root = directory();
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(root, format.filename), lockText(format.format));
  return root;
};
const targetMetadata = async () =>
  new Response(JSON.stringify({ name: "zod", version: "4.0.0" }));
const fakeManager = (
  root: string,
  format: (typeof formats)[number],
  next = lockText(format.format, "4.0.0", "^4.0.0"),
) => {
  const bin = directory();
  const observed = join(root, "invocation.json");
  writeFileSync(
    join(bin, format.manager),
    `#!${process.execPath}\nconst fs = require("node:fs");
if (process.argv.includes("--version")) { console.log(${JSON.stringify(format.version)}); process.exit(0); }
fs.writeFileSync(${JSON.stringify(observed)}, JSON.stringify({ args: process.argv.slice(2), env: process.env, cwd: process.cwd(), manifest: JSON.parse(fs.readFileSync("package.json", "utf8")) }));
fs.writeFileSync(${JSON.stringify(format.filename)}, ${JSON.stringify(next)});\n`,
  );
  chmodSync(join(bin, format.manager), 0o755);
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  return observed;
};

describe.each(formats)("$format lockfiles", (format) => {
  it("scans direct, scoped and development packages using locked versions", async () => {
    const root = fixture(format);
    expect(readPackageLock(root, "package.json").manager).toBe(format.manager);
    const scan = await scanRepository(root);
    expect(scan.skipped).toEqual([]);
    expect(
      scan.dependencies.map(({ package: name, currentVersion }) => [
        name,
        currentVersion,
      ]),
    ).toEqual([
      ["zod", "3.23.8"],
      ["@scope/pkg", "1.0.0"],
    ]);
  });
  it("rejects a stale manifest instead of using its declaration as the installed version", async () => {
    const root = fixture(format);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ ...manifest, dependencies: { zod: "^4.0.0" } }),
    );
    const scan = await scanRepository(root);
    expect(
      scan.dependencies.some((dependency) => dependency.package === "zod"),
    ).toBe(false);
    expect(scan.skipped.some((entry) => entry.package === "zod")).toBe(true);
  });
  it("uses the native manager without credentials and preserves the checkout", async () => {
    const root = fixture(format);
    const before = readFileSync(join(root, format.filename), "utf8");
    const observed = fakeManager(root, format);
    vi.stubEnv("TELEGRAPH_EVM_PRIVATE_KEY", "dummy-key");
    vi.stubEnv("GITHUB_TOKEN", "dummy-token");
    const update = await prepareUpdate(root, finding, targetMetadata);
    expect(update.files.map((file) => file.path)).toEqual([
      "package.json",
      format.filename,
    ]);
    expect(
      lockedVersions(
        format.filename,
        update.files[1].content,
        JSON.parse(update.files[0].content),
      ).zod,
    ).toBe("4.0.0");
    expect(readFileSync(join(root, format.filename), "utf8")).toBe(before);
    expect(
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    ).toEqual(manifest);
    const invocation = JSON.parse(readFileSync(observed, "utf8"));
    expect(invocation.args[0]).toBe("install");
    expect(invocation.env).not.toHaveProperty("TELEGRAPH_EVM_PRIVATE_KEY");
    expect(invocation.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(invocation.manifest.dependencies.zod).toBe("^4.0.0");
    if (format.format === "modern") {
      expect(invocation.args).toContain("--mode=update-lockfile");
      expect(invocation.env.YARN_ENABLE_SCRIPTS).toBe("false");
    } else expect(invocation.args).toContain("--ignore-scripts");
    if (format.manager === "pnpm")
      expect(invocation.args).toContain("--ignore-pnpmfile");
    expect(existsSync(invocation.cwd)).toBe(false);
  });
  it("rejects regeneration that resolves a different target", async () => {
    const root = fixture(format);
    fakeManager(root, format, lockText(format.format, "4.0.1", "^4.0.0"));
    await expect(prepareUpdate(root, finding, targetMetadata)).rejects.toThrow(
      /recommended version/,
    );
  });
  it("validates the matching lockfile and rejects unexpected files before contacting GitHub", async () => {
    const root = fixture(format);
    const update = {
      finding,
      files: [
        {
          path: "package.json",
          content: updateManifest(JSON.stringify(manifest), finding),
        },
        {
          path: format.filename,
          content: lockText(format.format, "4.0.0", "^4.0.0"),
        },
      ],
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([{ html_url: "https://github.com/team/repo/pull/1" }]),
        ),
    );
    const options = {
      root,
      update,
      fetchImpl,
      repository: "team/repo",
      baseSha: "a".repeat(40),
      baseBranch: "feature/test",
      token: "test",
      purchase: {
        minerId: "302",
        intent: "QUESTION_ANSWERING_GENERAL",
        amountUsdc: 0.01,
        receiptHash: "receipt",
        signalHash: "signal",
        txHash: "tx",
      },
    };
    expect(await createDependencyPr(options)).toContain("/pull/1");
    fetchImpl.mockClear();
    update.files[1].content = lockText(format.format, "4.0.1", "^4.0.0");
    await expect(createDependencyPr(options)).rejects.toThrow(
      /recommended version/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    update.files[1].path = "package-lock.json";
    await expect(createDependencyPr(options)).rejects.toThrow(
      /unexpected or missing/,
    );
  });
  it("surfaces package-manager failures and leaves the checkout unchanged", async () => {
    const root = fixture(format);
    const bin = directory();
    writeFileSync(
      join(bin, format.manager),
      `#!${process.execPath}\nif (process.argv.includes("--version")) { console.log(${JSON.stringify(format.version)}); } else { process.exit(42); }\n`,
    );
    chmodSync(join(bin, format.manager), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    await expect(prepareUpdate(root, finding, targetMetadata)).rejects.toThrow(
      /Command failed/,
    );
    expect(readFileSync(join(root, format.filename), "utf8")).toBe(
      lockText(format.format),
    );
  });
  it("rejects malformed lockfiles", async () => {
    const root = fixture(format);
    writeFileSync(join(root, format.filename), "[broken");
    const scan = await scanRepository(root);
    expect(scan.dependencies).toEqual([]);
    expect(scan.skipped).toHaveLength(2);
  });
});

it("fails closed on conflicting, binary, missing and escaped lockfiles", () => {
  const root = fixture(formats[1]);
  writeFileSync(join(root, "yarn.lock"), lockText("classic"));
  expect(() => readPackageLock(root, "package.json")).toThrow(/exactly one/);
  rmSync(join(root, "yarn.lock"));
  rmSync(join(root, "pnpm-lock.yaml"));
  expect(() => readPackageLock(root, "package.json")).toThrow(/exactly one/);
  writeFileSync(join(root, "bun.lockb"), "binary");
  expect(() => readPackageLock(root, "package.json")).toThrow(/migrate/);
  rmSync(join(root, "bun.lockb"));
  const outside = directory();
  writeFileSync(join(outside, "pnpm-lock.yaml"), lockText("pnpm9"));
  symlinkSync(join(outside, "pnpm-lock.yaml"), join(root, "pnpm-lock.yaml"));
  expect(() => readPackageLock(root, "package.json")).toThrow(
    /outside the repository/,
  );
});
it.each(formats)("rejects registry escapes in $format", (format) => {
  const content = lockText(format.format);
  let unsafe: string;
  if (format.manager === "pnpm")
    unsafe = content.replace(
      '"integrity":"sha512-example"',
      '"tarball":"https://evil.example/package.tgz"',
    );
  else if (format.format === "modern")
    unsafe = content.replace(
      "zod@npm:3.23.8",
      "zod@https://evil.example/package.tgz",
    );
  else if (format.manager === "bun")
    unsafe = content.replace(
      '"zod@3.23.8",',
      '"zod@https://evil.example/package.tgz",',
    );
  else
    unsafe = content.replace(
      "https://registry.yarnpkg.com",
      "https://evil.example",
    );
  expect(() => lockedVersions(format.filename, unsafe, manifest)).toThrow(
    /public registry/,
  );
});
it("requires the selected packageManager version without running install on mismatch", async () => {
  const format = formats[1];
  const root = fixture(format);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ ...manifest, packageManager: "pnpm@10.18.4" }),
  );
  const observed = fakeManager(root, format);
  await expect(prepareUpdate(root, finding, targetMetadata)).rejects.toThrow(
    /Install pnpm@10.18.4/,
  );
  expect(existsSync(observed)).toBe(false);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ ...manifest, packageManager: "yarn@1.22.22" }),
  );
  expect(() => readPackageLock(root, "package.json")).toThrow(/packageManager/);
});
it("keeps workspace lockfiles excluded", () => {
  const root = fixture(formats[1]);
  const lock = JSON.parse(lockText("pnpm9"));
  lock.importers["packages/member"] = {};
  writeFileSync(join(root, "pnpm-lock.yaml"), JSON.stringify(lock));
  expect(() => readPackageLock(root, "package.json")).toThrow(/workspace/);
  mkdirSync(join(root, "member"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ workspaces: ["member"] }),
  );
  writeFileSync(join(root, "member/package.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "member/bun.lock"), lockText("bun"));
  expect(() => readPackageLock(root, "member/package.json")).toThrow(
    /workspace/,
  );
});

it("rejects conflicting direct resolutions rather than choosing one", () => {
  const dual = {
    dependencies: { zod: "^3.0.0" },
    devDependencies: { zod: "^3.23.0" },
  };
  const lock = {
    __metadata: { version: 8 },
    "zod@npm:^3.0.0": { version: "3.20.0", resolution: "zod@npm:3.20.0" },
    "zod@npm:^3.23.0": { version: "3.23.8", resolution: "zod@npm:3.23.8" },
  };
  expect(() => lockedVersions("yarn.lock", JSON.stringify(lock), dual)).toThrow(
    /Ambiguous/,
  );
});
it.each([formats[1], formats[4]])(
  "rejects extra root declarations in $format",
  (format) => {
    const content = lockText(format.format);
    expect(() =>
      lockedVersions(format.filename, content, {
        dependencies: manifest.dependencies,
      }),
    ).toThrow(/declarations differ/);
  },
);
it.each(formats)(
  "skips unsupported override configuration before assessment in $format",
  async (format) => {
    const root = fixture(format);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ ...manifest, overrides: { zod: "4.0.0" } }),
    );
    const scan = await scanRepository(root);
    expect(scan.dependencies).toEqual([]);
    expect(
      scan.skipped.every((entry) =>
        entry.reason.includes("custom configuration"),
      ),
    ).toBe(true);
  },
);

it("starts the bundled action without unresolved parser modules", () => {
  const execution = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../dist/index.cjs", import.meta.url))],
    {
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    },
  );
  expect(execution.status).toBe(1);
  expect(execution.stdout).toContain("GITHUB_TOKEN is required");
  expect(execution.stderr).not.toContain("MODULE_NOT_FOUND");
});

it("reads pnpm v6 peer-specific package keys", () => {
  const lock = JSON.parse(lockText("pnpm6"));
  lock.packages["/zod@3.23.8(@scope/pkg@1.0.0)"] = lock.packages["/zod@3.23.8"];
  delete lock.packages["/zod@3.23.8"];
  expect(
    lockedVersions("pnpm-lock.yaml", JSON.stringify(lock), manifest).zod,
  ).toBe("3.23.8");
});

it("rejects Yarn locators that redirect archives away from the registry", () => {
  const content = lockText("modern").replace(
    "zod@npm:3.23.8",
    "zod@npm:3.23.8::__archiveUrl=https%3A%2F%2Fevil.example%2Fpackage.tgz",
  );
  expect(() => lockedVersions("yarn.lock", content, manifest)).toThrow(
    /public registry/,
  );
});
