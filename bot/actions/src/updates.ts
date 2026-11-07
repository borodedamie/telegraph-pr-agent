import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { Finding } from "./assessment";

export type ChangedFile = { path: string; content: string };
export type PreparedUpdate = { finding: Finding; files: ChangedFile[] };

// Only bundles produced by preparation may pass the publisher's file allowlist.
const verifiedBundles = new WeakMap<PreparedUpdate, string>();
export const hasVerifiedBundle = (update: PreparedUpdate): boolean => {
  const bundle = update.files.find((file) => file.path === "bot/actions/dist/index.js");
  return !!bundle && verifiedBundles.get(update) === createHash("sha256").update(bundle.content).digest("hex");
};

const rebuildAction = (root: string, update: PreparedUpdate): string => {
  const lock = JSON.parse(update.files.find((file) => file.path === "bot/actions/package-lock.json")!.content);
  // shortcut: the trusted builder is pinned; validate new tooling before supporting builder upgrades.
  if (lock.packages?.["node_modules/esbuild"]?.version !== "0.28.2") {
    throw new Error("Action bundle rebuild requires the verified esbuild 0.28.2 toolchain");
  }
  const directory = mkdtempSync(join(tmpdir(), "telegraph-bundle-"));
  const env = { PATH: process.env.PATH, HOME: directory, TMPDIR: directory,
    npm_config_cache: join(directory, ".npm-cache"), npm_config_userconfig: join(directory, "user.npmrc"),
    npm_config_globalconfig: join(directory, "global.npmrc") };
  const run = (args: string[], cwd: string) => execFileSync("npm", args, {
    cwd, env, timeout: 120_000, stdio: "pipe",
  });
  try {
    const paths = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0");
    for (const path of paths.filter((path) => /^(?:bot\/(?:src|actions\/src)\/.*\.ts|(?:bot\/(?:actions\/)?)?package\.json|pnpm-(?:lock\.yaml|workspace\.yaml))$/.test(path))) {
      const destination = join(directory, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readRepositoryFile(root, path));
    }
    for (const file of update.files) {
      const destination = join(directory, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
    }
    // Run fixed package-manager/build tools, never scripts from the assessed repository.
    run(["exec", "--yes", "--package=pnpm@10.18.3", "--", "pnpm", "--filter", "@telegraph-pr-agent/bot",
      "install", "--frozen-lockfile", "--ignore-scripts"], directory);
    const actionDirectory = join(directory, "bot/actions");
    run(["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"], actionDirectory);
    const build = ["exec", "--yes", "--package=esbuild@0.28.2", "--", "esbuild", "src/index.ts", "--bundle",
      "--platform=node", "--target=node24", "--format=cjs", "--minify", "--outfile=dist/index.js"];
    run(build, actionDirectory);
    const bundle = readFileSync(join(actionDirectory, "dist/index.js"), "utf8");
    run(build, actionDirectory);
    if (bundle !== readFileSync(join(actionDirectory, "dist/index.js"), "utf8")) {
      throw new Error("Action bundle rebuild was not reproducible");
    }
    return bundle;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

export const readRepositoryFile = (root: string, source: string): string => {
  if (isAbsolute(source) || source.split(/[\\/]/).includes("..") || source.includes("\\")) {
    throw new Error(`Unsafe dependency path: ${source}`);
  }
  const path = join(root, source);
  const location = relative(realpathSync(root), realpathSync(path));
  if (!lstatSync(path).isFile() || location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
    throw new Error(`Dependency file is outside the repository or is not a regular file: ${source}`);
  }
  return readFileSync(path, "utf8");
};

export const updateManifest = (content: string, finding: Finding): string => {
  if (finding.ecosystem === "npm") {
    const manifest = JSON.parse(content);
    let changed = false;
    for (const section of ["dependencies", "devDependencies"]) {
      const declared: unknown = manifest[section]?.[finding.package];
      if (typeof declared !== "string") continue;
      if (!/^[~^]?\d/.test(declared)) throw new Error(`Unsupported npm declaration: ${finding.package}`);
      const prefix = declared.startsWith("^") || declared.startsWith("~") ? declared[0] : "";
      manifest[section][finding.package] = `${prefix}${finding.targetVersion}`;
      changed = true;
    }
    if (!changed) throw new Error(`Dependency no longer exists: ${finding.package}`);
    const indent = content.match(/\n([ \t]+)"/)?.[1] ?? "  ";
    return `${JSON.stringify(manifest, null, indent)}${content.endsWith("\n") ? "\n" : ""}`;
  }
  let changes = 0;
  const updated = content.split(/(?<=\n)/).map((line) => {
    const pin = line.match(/^(\s*)([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]+\])?(\s*==\s*)([^\s;]+)(.*)$/s);
    if (!pin || pin[2].toLowerCase().replace(/[-_.]+/g, "-") !== finding.package
      || pin[5] !== finding.currentVersion) return line;
    // shortcut: hashed exports need regenerated hashes, support them when a Python lock updater exists.
    if (pin[6].includes("--hash") || /\\\s*$/.test(line.trimEnd())) {
      throw new Error(`Hashed or continued Python pins require lock regeneration: ${finding.package}`);
    }
    changes += 1;
    return `${pin[1]}${pin[2]}${pin[3] ?? ""}${pin[4]}${finding.targetVersion}${pin[6]}`;
  }).join("");
  if (!changes) throw new Error(`Python pin no longer matches: ${finding.package}`);
  return updated;
};

export const prepareUpdate = async (
  root: string,
  finding: Finding,
  fetchImpl: typeof fetch = fetch,
  runNpm: (directory: string) => void = (directory) => {
    execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund",
      "--registry=https://registry.npmjs.org", `--userconfig=${join(directory, "user.npmrc")}`, `--globalconfig=${join(directory, "global.npmrc")}`], {
      cwd: directory,
      env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory,
        npm_config_cache: join(directory, ".npm-cache") },
      timeout: 120_000, stdio: "pipe",
    });
  },
  buildAction: (root: string, update: PreparedUpdate) => string = rebuildAction,
): Promise<PreparedUpdate> => {
  const metadataUrl = finding.ecosystem === "npm"
    ? `https://registry.npmjs.org/${encodeURIComponent(finding.package)}/${finding.targetVersion}`
    : `https://pypi.org/pypi/${encodeURIComponent(finding.package)}/${finding.targetVersion}/json`;
  const response = await fetchImpl(metadataUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Target version lookup failed: HTTP ${response.status} for ${finding.package}`);
  const metadata = await response.json() as { name?: string; version?: string; info?: { name?: string; version?: string }; urls?: { yanked?: boolean }[] };
  const name = finding.ecosystem === "npm" ? metadata.name : metadata.info?.name?.toLowerCase().replace(/[-_.]+/g, "-");
  const version = finding.ecosystem === "npm" ? metadata.version : metadata.info?.version;
  if (name !== finding.package || version !== finding.targetVersion
    || (finding.ecosystem === "PyPI" && (!metadata.urls?.length || metadata.urls.every((file) => file.yanked)))) {
    throw new Error(`Target is missing, mismatched or yanked: ${finding.package}@${finding.targetVersion}`);
  }
  const content = readRepositoryFile(root, finding.source);
  const updated = updateManifest(content, finding);
  const files = [{ path: finding.source, content: updated }];
  if (finding.ecosystem === "npm") {
    const project = dirname(finding.source);
    const manifest = JSON.parse(content);
    const lockPath = join(project, "package-lock.json").split(sep).join("/");
    // shortcut: workspace and pnpm lock updates need their own resolver; never publish stale locks.
    if (manifest.workspaces || !existsSync(join(root, lockPath))) {
      throw new Error(`Automatic npm updates require a standalone package-lock.json: ${finding.source}`);
    }
    let ancestor = dirname(join(root, project));
    while (ancestor.startsWith(`${root}${sep}`) || ancestor === root) {
      const ancestorManifest = join(ancestor, "package.json");
      // Conservatively reject descendants of workspace roots, including members with local locks.
      if (existsSync(ancestorManifest) && JSON.parse(readRepositoryFile(root,
        relative(root, ancestorManifest).split(sep).join("/"))).workspaces) {
        throw new Error(`Automatic npm updates do not support workspace members: ${finding.source}`);
      }
      if (ancestor === root) break;
      ancestor = dirname(ancestor);
    }
    const lockContent = readRepositoryFile(root, lockPath);
    const lock = JSON.parse(lockContent);
    if (![2, 3].includes(lock.lockfileVersion)) throw new Error("Only npm lockfile v2/v3 updates are supported");
    for (const entry of Object.values(lock.packages ?? {}) as { resolved?: string; link?: boolean }[]) {
      if (entry.link || (entry.resolved && !entry.resolved.startsWith("https://registry.npmjs.org/"))) {
        throw new Error("Lock regeneration only supports public npm registry packages");
      }
    }
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (Object.values(manifest[section] ?? {}).some((value) => typeof value !== "string" || /^(?:file:|link:|git|https?:|npm:|workspace:)/.test(value))) {
        throw new Error("Lock regeneration does not support local, URL, Git or alias dependencies");
      }
    }
    const directory = mkdtempSync(join(tmpdir(), "telegraph-lock-"));
    try {
      const pinnedManifest = JSON.parse(updated);
      for (const section of ["dependencies", "devDependencies"]) {
        if (pinnedManifest[section]?.[finding.package]) pinnedManifest[section][finding.package] = finding.targetVersion;
      }
      writeFileSync(join(directory, "package.json"), JSON.stringify(pinnedManifest));
      writeFileSync(join(directory, "package-lock.json"), lockContent);
      runNpm(directory);
      const regenerated = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"));
      if (regenerated.packages?.[`node_modules/${finding.package}`]?.version !== finding.targetVersion) {
        throw new Error("Regenerated lockfile did not resolve the recommended version");
      }
      for (const section of ["dependencies", "devDependencies"]) {
        if (regenerated.packages[""]?.[section]?.[finding.package]) {
          regenerated.packages[""][section][finding.package] = JSON.parse(updated)[section][finding.package];
        }
      }
      files.push({ path: lockPath, content: `${JSON.stringify(regenerated, null, 2)}\n` });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  const update = { finding, files };
  if (finding.source === "bot/actions/package.json") {
    readRepositoryFile(root, "bot/actions/dist/index.js");
    const bundle = buildAction(root, update);
    files.push({ path: "bot/actions/dist/index.js", content: bundle });
    verifiedBundles.set(update, createHash("sha256").update(bundle).digest("hex"));
  }
  return update;
};
