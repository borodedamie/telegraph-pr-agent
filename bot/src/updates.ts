import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseSyml } from "@yarnpkg/parsers";
import {
  lockedVersions,
  readPackageLock,
  readRepositoryFile,
  type PackageLock,
} from "./lockfiles.js";
import type { Finding } from "./assessment.js";

export { readRepositoryFile } from "./lockfiles.js";

export type ChangedFile = { path: string; content: string };
export type PreparedUpdate = { finding: Finding; files: ChangedFile[] };

export const updateManifest = (
  content: string,
  finding: Pick<
    Finding,
    "ecosystem" | "package" | "currentVersion" | "targetVersion"
  >,
): string => {
  if (finding.ecosystem === "npm") {
    const manifest = JSON.parse(content);
    let changed = false;
    for (const section of ["dependencies", "devDependencies"]) {
      const declared: unknown = manifest[section]?.[finding.package];
      if (typeof declared !== "string") continue;
      if (!/^[~^]?\d/.test(declared))
        throw new Error(`Unsupported npm declaration: ${finding.package}`);
      const prefix =
        declared.startsWith("^") || declared.startsWith("~") ? declared[0] : "";
      manifest[section][finding.package] = `${prefix}${finding.targetVersion}`;
      changed = true;
    }
    if (!changed)
      throw new Error(`Dependency no longer exists: ${finding.package}`);
    const indent = content.match(/\n([ \t]+)"/)?.[1] ?? "  ";
    return `${JSON.stringify(manifest, null, indent)}${content.endsWith("\n") ? "\n" : ""}`;
  }
  let changes = 0;
  const updated = content
    .split(/(?<=\n)/)
    .map((line) => {
      const pin = line.match(
        /^(\s*)([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]+\])?(\s*==\s*)([^\s;]+)(.*)$/s,
      );
      if (
        !pin ||
        pin[2].toLowerCase().replace(/[-_.]+/g, "-") !== finding.package ||
        pin[5] !== finding.currentVersion
      )
        return line;
      // shortcut: hashed exports need regenerated hashes, support them when a Python lock updater exists.
      if (pin[6].includes("--hash") || /\\\s*$/.test(line.trimEnd())) {
        throw new Error(
          `Hashed or continued Python pins require lock regeneration: ${finding.package}`,
        );
      }
      changes += 1;
      return `${pin[1]}${pin[2]}${pin[3] ?? ""}${pin[4]}${finding.targetVersion}${pin[6]}`;
    })
    .join("");
  if (!changes)
    throw new Error(`Python pin no longer matches: ${finding.package}`);
  return updated;
};

const runPackageManager = (directory: string, lock: PackageLock): void => {
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    TMPDIR: directory,
    XDG_CONFIG_HOME: directory,
    XDG_CACHE_HOME: join(directory, ".cache"),
    CI: "true",
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    COREPACK_ENABLE_AUTO_PIN: "0",
    npm_config_manage_package_manager_versions: "false",
    npm_config_userconfig: join(directory, "user.npmrc"),
    npm_config_globalconfig: join(directory, "global.npmrc"),
    YARN_IGNORE_PATH: "1",
    YARN_ENABLE_SCRIPTS: "false",
    YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
    YARN_ENABLE_GLOBAL_CACHE: "false",
    YARN_NPM_REGISTRY_SERVER: "https://registry.npmjs.org",
    YARN_RC_FILENAME: ".telegraph-yarnrc.yml",
  };
  const options = {
    cwd: directory,
    env,
    timeout: 120_000,
    stdio: "pipe" as const,
  };
  const installed = execFileSync(lock.manager, ["--version"], {
    ...options,
    encoding: "utf8",
  }).trim();
  if (!/^\d+\.\d+\.\d+$/.test(installed))
    throw new Error(`Cannot identify installed ${lock.manager} version`);
  const manifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  if (
    manifest.packageManager &&
    manifest.packageManager.split("@")[1].split("+")[0] !== installed
  ) {
    throw new Error(
      `Install ${manifest.packageManager} before preparing this update; found ${lock.manager}@${installed}`,
    );
  }
  let args: string[];
  if (lock.manager === "pnpm") {
    const version = Number(parseSyml(lock.content).lockfileVersion);
    const major = Number(installed.split(".")[0]);
    if (
      (version === 6 && major !== 8) ||
      (version === 9 && ![9, 10, 11].includes(major))
    ) {
      throw new Error("Installed pnpm does not match the lockfile format");
    }
    args = [
      "install",
      "--lockfile-only",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--no-frozen-lockfile",
      "--config.manage-package-manager-versions=false",
      "--registry=https://registry.npmjs.org",
    ];
  } else if (lock.manager === "yarn") {
    const modern = Object.hasOwn(parseSyml(lock.content), "__metadata");
    const installedModern = Number(installed.split(".")[0]) >= 2;
    if (modern !== installedModern)
      throw new Error("Installed Yarn does not match the lockfile format");
    args = modern
      ? ["install", "--mode=update-lockfile"]
      : [
          "install",
          "--ignore-scripts",
          "--non-interactive",
          "--registry=https://registry.npmjs.org",
        ];
  } else {
    args = [
      "install",
      "--lockfile-only",
      "--ignore-scripts",
      "--registry=https://registry.npmjs.org",
    ];
  }
  execFileSync(lock.manager, args, options);
};

export const prepareUpdate = async (
  root: string,
  finding: Finding,
  fetchImpl: typeof fetch = fetch,
  runNpm: (directory: string) => void = (directory) => {
    execFileSync(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
        `--userconfig=${join(directory, "user.npmrc")}`,
        `--globalconfig=${join(directory, "global.npmrc")}`,
      ],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          TMPDIR: directory,
          npm_config_cache: join(directory, ".npm-cache"),
        },
        timeout: 120_000,
        stdio: "pipe",
      },
    );
  },
): Promise<PreparedUpdate> => {
  const metadataUrl =
    finding.ecosystem === "npm"
      ? `https://registry.npmjs.org/${encodeURIComponent(finding.package)}/${finding.targetVersion}`
      : `https://pypi.org/pypi/${encodeURIComponent(finding.package)}/${finding.targetVersion}/json`;
  const response = await fetchImpl(metadataUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Target version lookup failed: HTTP ${response.status} for ${finding.package}`,
    );
  const metadata = (await response.json()) as {
    name?: string;
    version?: string;
    info?: { name?: string; version?: string };
    urls?: { yanked?: boolean }[];
  };
  const name =
    finding.ecosystem === "npm"
      ? metadata.name
      : metadata.info?.name?.toLowerCase().replace(/[-_.]+/g, "-");
  const version =
    finding.ecosystem === "npm" ? metadata.version : metadata.info?.version;
  if (
    name !== finding.package ||
    version !== finding.targetVersion ||
    (finding.ecosystem === "PyPI" &&
      (!metadata.urls?.length || metadata.urls.every((file) => file.yanked)))
  ) {
    throw new Error(
      `Target is missing, mismatched or yanked: ${finding.package}@${finding.targetVersion}`,
    );
  }
  const content = readRepositoryFile(root, finding.source);
  const updated = updateManifest(content, finding);
  const files = [{ path: finding.source, content: updated }];
  if (finding.ecosystem === "npm") {
    const lock = readPackageLock(root, finding.source);
    const lockPath = lock.path;
    const lockContent = lock.content;
    const lockName = basename(lockPath);
    const directory = mkdtempSync(join(tmpdir(), "telegraph-lock-"));
    try {
      const pinnedManifest = JSON.parse(updated);
      for (const section of ["dependencies", "devDependencies"]) {
        if (
          lock.manager === "npm" &&
          pinnedManifest[section]?.[finding.package]
        )
          pinnedManifest[section][finding.package] = finding.targetVersion;
      }
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify(pinnedManifest),
      );
      writeFileSync(join(directory, lockName), lockContent);
      if (lock.manager !== "npm") {
        runPackageManager(directory, lock);
        const regenerated = readFileSync(join(directory, lockName), "utf8");
        if (
          lockedVersions(lockPath, regenerated, JSON.parse(updated))[
            finding.package
          ] !== finding.targetVersion
        ) {
          throw new Error(
            "Regenerated lockfile did not resolve the recommended version",
          );
        }
        files.push({ path: lockPath, content: regenerated });
      } else {
        runNpm(directory);
        const regenerated = JSON.parse(
          readFileSync(join(directory, "package-lock.json"), "utf8"),
        );
        if (
          regenerated.packages?.[`node_modules/${finding.package}`]?.version !==
          finding.targetVersion
        ) {
          throw new Error(
            "Regenerated lockfile did not resolve the recommended version",
          );
        }
        for (const section of ["dependencies", "devDependencies"]) {
          if (regenerated.packages[""]?.[section]?.[finding.package]) {
            regenerated.packages[""][section][finding.package] =
              JSON.parse(updated)[section][finding.package];
          }
        }
        files.push({
          path: lockPath,
          content: `${JSON.stringify(regenerated, null, 2)}\n`,
        });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  return { finding, files };
};
