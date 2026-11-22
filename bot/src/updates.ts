import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseSyml } from "@yarnpkg/parsers";
import {
  lockedVersions,
  readPackageLock,
  readRepositoryFile,
  restoreLockDeclarations,
  type PackageLock,
} from "./lockfiles.js";
import type { Finding } from "./assessment.js";
import type { Dependency } from "./scan.js";

export { readRepositoryFile } from "./lockfiles.js";

export type ChangedFile = { path: string; content: string };
export type PreparedUpdate = { finding: Finding; files: ChangedFile[] };

/**
 * The package manager refused the upgrade, e.g. react-dom 19 needs react 19 while the repository is
 * on react 18 (npm ERESOLVE). The answer about it is still valid; the upgrade just can't be made on
 * its own yet. The message carries the package manager's own reason.
 */
export class UpdatePreparationError extends Error {}

// The lines of a package manager's error output that say why, without the noise around them.
const managerReason = (stderr: string): string => {
  const lines = stderr.split("\n")
    .map((line) => line.replace(/^\s*(npm (error|ERR!)|ERR_PNPM_\w+|➤ YN\d+:|error)\s*/i, "").trim())
    // Headings like "code ERESOLVE" and "Could not resolve dependency:" say nothing on their own.
    // npm's advice to retry with --force / --legacy-peer-deps is left out: the bot never does that.
    // Paths to npm's log files point into a temporary directory that is already gone.
    .filter((line) => !/^code\b/i.test(line) && !line.endsWith(":") && !/--force|--legacy-peer-deps|_logs\/|^\//.test(line))
    .filter((line) => /ERESOLVE|Could not resolve|peer |Found: |ETARGET|No matching version|conflict|Unsupported/i.test(line));
  return [...new Set(lines)].slice(0, 4).join(" · ").slice(0, 400);
};

/** Run a package manager; when it fails, say which upgrade and why instead of only "Command failed". */
const resolving = (finding: Finding, run: () => void): void => {
  try {
    run();
  } catch (error) {
    const failed = error as { status?: unknown; stderr?: unknown };
    if (failed.status === undefined && failed.stderr === undefined) throw error;
    const reason = managerReason(String(failed.stderr ?? "")) || (error instanceof Error ? error.message : String(error)).slice(0, 300);
    throw new UpdatePreparationError(
      `${finding.package}@${finding.targetVersion} can't be installed alongside the repository's current dependencies (${reason})`,
    );
  }
};

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

const runPackageManager = (
  directory: string,
  lock: PackageLock,
  checkOnly = false,
): void => {
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
  if (!checkOnly) execFileSync(lock.manager, args, options);
};

export const checkPackageManager = (
  root: string,
  dependency: { ecosystem: string; source: string },
): void => {
  if (dependency.ecosystem !== "npm") return;
  const lock = readPackageLock(root, dependency.source);
  if (lock.manager === "npm") return;
  const directory = mkdtempSync(join(tmpdir(), "telegraph-manager-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      readRepositoryFile(root, dependency.source),
    );
    runPackageManager(directory, lock, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
        if (pinnedManifest[section]?.[finding.package])
          pinnedManifest[section][finding.package] = finding.targetVersion;
      }
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify(pinnedManifest),
      );
      writeFileSync(join(directory, lockName), lockContent);
      if (lock.manager !== "npm") {
        resolving(finding, () => runPackageManager(directory, lock));
        let regenerated = readFileSync(join(directory, lockName), "utf8");
        if (
          lockedVersions(lockPath, regenerated, pinnedManifest)[
            finding.package
          ] !== finding.targetVersion
        ) {
          throw new Error(
            "Regenerated lockfile did not resolve the recommended version",
          );
        }
        regenerated = restoreLockDeclarations(
          lock,
          regenerated,
          JSON.parse(updated),
          finding,
        );
        writeFileSync(join(directory, "package.json"), updated);
        writeFileSync(join(directory, lockName), regenerated);
        resolving(finding, () => runPackageManager(directory, lock));
        regenerated = readFileSync(join(directory, lockName), "utf8");
        if (
          lockedVersions(lockPath, regenerated, JSON.parse(updated))[
            finding.package
          ] !== finding.targetVersion
        ) {
          throw new Error(
            "Restored lockfile did not retain the recommended version",
          );
        }
        files.push({ path: lockPath, content: regenerated });
      } else {
        resolving(finding, () => runNpm(directory));
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

/**
 * Prepare the upgrade before paying for an answer about it: the target is already known, so an
 * upgrade the package manager can't install is found out for free. Throws what prepareUpdate throws.
 */
export const checkUpgradeInstallable = async (
  root: string,
  dependency: Pick<Dependency, "ecosystem" | "package" | "source" | "currentVersion" | "targetVersion">,
  fetchImpl: typeof fetch = fetch,
  runNpm?: Parameters<typeof prepareUpdate>[3],
): Promise<void> => {
  if (!dependency.targetVersion) return;
  await prepareUpdate(root, {
    ecosystem: dependency.ecosystem, package: dependency.package, source: dependency.source,
    currentVersion: dependency.currentVersion, targetVersion: dependency.targetVersion,
    issue: "outdated", reason: "install check before purchase", cves: [], sources: ["https://registry.npmjs.org"],
  }, fetchImpl, runNpm);
};
