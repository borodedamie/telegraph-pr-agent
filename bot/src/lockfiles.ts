import { existsSync, lstatSync, realpathSync, readFileSync } from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  matchesGlob,
  relative,
  sep,
} from "node:path";
import semver from "semver";
import {
  parse as parseJsonc,
  modify,
  applyEdits,
  type ParseError,
} from "jsonc-parser/lib/esm/main.js";
import { parseSyml, stringifySyml } from "@yarnpkg/parsers";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type PackageLock = {
  manager: PackageManager;
  path: string;
  content: string;
};
type Manifest = {
  pnpm?: unknown;
  resolutions?: unknown;
  overrides?: unknown;
  name?: string;
  packageManager?: string;
  workspaces?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export const readRepositoryFile = (root: string, source: string): string => {
  if (
    isAbsolute(source) ||
    source.split(/[\\/]/).includes("..") ||
    source.includes("\\")
  ) {
    throw new Error(`Unsafe dependency path: ${source}`);
  }
  const path = join(root, source);
  const location = relative(realpathSync(root), realpathSync(path));
  if (
    !lstatSync(path).isFile() ||
    location === ".." ||
    location.startsWith(`..${sep}`) ||
    isAbsolute(location)
  ) {
    throw new Error(
      `Dependency file is outside the repository or is not a regular file: ${source}`,
    );
  }
  return readFileSync(path, "utf8");
};

export const readPackageLock = (root: string, source: string): PackageLock => {
  const project = dirname(source);
  const manifest: Manifest = JSON.parse(readRepositoryFile(root, source));
  const candidates = [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ].filter((name) => existsSync(join(root, project, name)));
  if (candidates.length !== 1)
    throw new Error(`Require exactly one supported lockfile: ${source}`);
  const filename = candidates[0];
  // shortcut: publishing supports text files; handle binary Bun locks when binary blobs are supported.
  if (filename === "bun.lockb")
    throw new Error(
      "Binary bun.lockb is unsupported; migrate to bun.lock with Bun first",
    );
  if (manifest.workspaces)
    throw new Error(
      `Automatic updates do not support workspace members: ${source}`,
    );
  let ancestor = join(root, project);
  while (ancestor.startsWith(`${root}${sep}`) || ancestor === root) {
    const workspace = join(ancestor, "pnpm-workspace.yaml");
    if (existsSync(workspace)) {
      const configuration = readRepositoryFile(
        root,
        relative(root, workspace).split(sep).join("/"),
      );
      const block = configuration.match(
        /^packages:[ \t]*\r?\n((?:[ \t]+[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\r?\n)*)/m,
      )?.[1];
      const patterns: string[] = [];
      for (const line of (block ?? "")
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith("#"))) {
        const pattern = line.match(
          /^\s+-\s+(['"]?)([A-Za-z0-9_./!*?{}@()+,-]+)\1\s*(?:#.*)?$/,
        )?.[2];
        if (!pattern)
          throw new Error(
            "Unsupported pnpm workspace configuration; skip automatic npm updates",
          );
        patterns.push(pattern);
      }
      // shortcut: parse block-style pnpm package globs only; fail closed on other YAML forms.
      if (!patterns.some((pattern) => !pattern.startsWith("!")))
        throw new Error(
          "Unsupported pnpm workspace configuration; skip automatic npm updates",
        );
      const member = relative(ancestor, join(root, project))
        .split(sep)
        .join("/");
      if (
        !member ||
        (patterns.some(
          (pattern) => !pattern.startsWith("!") && matchesGlob(member, pattern),
        ) &&
          !patterns.some(
            (pattern) =>
              pattern.startsWith("!") && matchesGlob(member, pattern.slice(1)),
          ))
      ) {
        throw new Error(
          `Automatic npm updates do not support pnpm workspace members: ${source}`,
        );
      }
    }
    const ancestorManifest = join(ancestor, "package.json");
    // Conservatively reject descendants of workspace roots, including members with local locks.
    if (
      existsSync(ancestorManifest) &&
      JSON.parse(
        readRepositoryFile(
          root,
          relative(root, ancestorManifest).split(sep).join("/"),
        ),
      ).workspaces
    ) {
      throw new Error(
        `Automatic npm updates do not support workspace members: ${source}`,
      );
    }
    if (ancestor === root) break;
    ancestor = dirname(ancestor);
  }
  const managers = {
    "package-lock.json": "npm",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "bun.lock": "bun",
  } as const;
  const manager = managers[filename as keyof typeof managers];
  const path = join(project, filename).split(sep).join("/");
  const content = readRepositoryFile(root, path);
  if (
    manifest.packageManager &&
    !new RegExp(
      `^${manager}@[0-9]+\\.[0-9]+\\.[0-9]+(?:\\+sha(?:1|224|256|384|512)\\.[a-f0-9]+)?$`,
    ).test(manifest.packageManager)
  ) {
    throw new Error(
      "packageManager must pin the selected lockfile's manager to a release version",
    );
  }
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const) {
    if (
      Object.values(manifest[section] ?? {}).some(
        (value) =>
          typeof value !== "string" ||
          /^(?:file:|link:|git|https?:|npm:|workspace:)/.test(value),
      )
    ) {
      throw new Error(
        "Lock regeneration does not support local, URL, Git or alias dependencies",
      );
    }
  }
  if (
    manager !== "npm" &&
    (manifest.pnpm || manifest.resolutions || manifest.overrides)
  ) {
    throw new Error(
      "Package-manager overrides and custom configuration are unsupported",
    );
  }
  lockedVersions(filename, content, manifest);
  return { manager, path, content };
};

const publicTarball = (url: unknown): boolean => {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      ["registry.npmjs.org", "registry.yarnpkg.com"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
};

const isBuiltinYarnPatch = (resolution: string, version: string): boolean => {
  const match = resolution.match(
    /^(typescript|resolve|fsevents)@patch:([^#]+)#(?:optional!)?~?builtin<compat\/\1>(?:::(.*))?$/,
  );
  if (!match) return false;
  try {
    if (decodeURIComponent(match[2]) !== `${match[1]}@npm:${version}`)
      return false;
  } catch {
    return false;
  }
  const parameters = new URLSearchParams(match[3]);
  return (
    [...parameters].every(
      ([key, value]) =>
        (key === "version" && value === version) ||
        (key === "hash" && /^[a-f0-9]{1,128}$/.test(value)),
    ) && new Set(parameters.keys()).size === [...parameters].length
  );
};

export const lockedVersions = (
  filename: string,
  content: string,
  manifest: Manifest,
): Record<string, string> => {
  const versions: Record<string, string> = Object.create(null);
  const sections = ["dependencies", "devDependencies"] as const;
  if (filename.endsWith("package-lock.json")) {
    const lock = JSON.parse(content);
    if (![2, 3].includes(lock.lockfileVersion))
      throw new Error("Only npm lockfile v2/v3 updates are supported");
    for (const entry of Object.values(lock.packages ?? {}) as {
      resolved?: string;
      link?: boolean;
    }[]) {
      if (
        entry.link ||
        (entry.resolved &&
          !entry.resolved.startsWith("https://registry.npmjs.org/"))
      ) {
        throw new Error(
          "Lock regeneration only supports public npm registry packages",
        );
      }
    }
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      versions[name] = lock.packages?.[`node_modules/${name}`]?.version;
    }
  } else if (filename.endsWith("pnpm-lock.yaml")) {
    const lock = parseSyml(content);
    if (![6, 9].includes(Number(lock?.lockfileVersion)))
      throw new Error("Only pnpm lockfile v6/v9 updates are supported");
    if (
      lock.importers &&
      Object.keys(lock.importers).some((key) => key !== ".")
    )
      throw new Error("pnpm workspace locks are unsupported");
    const importer = lock.importers?.["."] ?? lock;
    for (const [key, entry] of Object.entries(lock.packages ?? {}) as [
      string,
      { resolution?: { tarball?: string; type?: string; directory?: string } },
    ][]) {
      const normalized = key.replace(/^\//, "").split("(")[0];
      const version = normalized.slice(normalized.lastIndexOf("@") + 1);
      if (
        !semver.valid(version) ||
        entry.resolution?.type ||
        entry.resolution?.directory ||
        (entry.resolution?.tarball && !publicTarball(entry.resolution.tarball))
      ) {
        throw new Error(
          "pnpm locks must contain public registry packages only",
        );
      }
    }
    for (const section of sections) {
      if (
        JSON.stringify(Object.keys(importer[section] ?? {}).sort()) !==
        JSON.stringify(Object.keys(manifest[section] ?? {}).sort())
      ) {
        throw new Error("pnpm lockfile declarations differ from the manifest");
      }
    }
    for (const section of sections)
      for (const [name, declared] of Object.entries(manifest[section] ?? {})) {
        const entry = importer[section]?.[name];
        if (
          !entry ||
          entry.specifier !== declared ||
          typeof entry.version !== "string"
        )
          throw new Error(
            `pnpm lockfile declarations differ from the manifest: ${name}`,
          );
        const version = entry.version.split("(")[0];
        const packages = lock.packages ?? {};
        if (
          ![
            `${name}@${version}`,
            `/${name}@${version}`,
            `${name}@${entry.version}`,
            `/${name}@${entry.version}`,
          ].some((key) => Object.hasOwn(packages, key))
        )
          throw new Error(`Missing pnpm package resolution: ${name}`);
        if (versions[name] && versions[name] !== version)
          throw new Error(`Ambiguous locked versions: ${name}`);
        versions[name] = version;
      }
  } else if (filename.endsWith("yarn.lock")) {
    const lock = parseSyml(content) as Record<
      string,
      { version?: string; resolved?: string; resolution?: string }
    >;
    for (const [selectors, entry] of Object.entries(lock)) {
      if (selectors === "__metadata") continue;
      if (entry.resolution?.endsWith("@workspace:.")) continue;
      const resolutionVersion = entry.resolution?.match(
        /^(?:@[^/]+\/)?[^@]+@npm:(.+)$/,
      )?.[1];
      if (
        !semver.valid(entry.version ?? "") ||
        (entry.resolved && !publicTarball(entry.resolved)) ||
        (entry.resolution &&
          (resolutionVersion !== entry.version ||
            semver.valid(resolutionVersion ?? "") === null) &&
          !isBuiltinYarnPatch(entry.resolution, entry.version ?? ""))
      ) {
        throw new Error(
          "Yarn locks must contain public registry packages only",
        );
      }
    }
    for (const section of sections)
      for (const [name, declared] of Object.entries(manifest[section] ?? {})) {
        const selector = `${name}@${lock.__metadata ? "npm:" : ""}${declared}`;
        const matches = Object.entries(lock).filter(([key]) =>
          key.split(/,\s*/).includes(selector),
        );
        if (matches.length !== 1 || !matches[0][1].version)
          throw new Error(`Missing or ambiguous Yarn resolution: ${name}`);
        const version = matches[0][1].version!;
        if (versions[name] && versions[name] !== version)
          throw new Error(`Ambiguous locked versions: ${name}`);
        versions[name] = version;
      }
  } else if (filename.endsWith("bun.lock")) {
    const errors: ParseError[] = [];
    const lock = parseJsonc(content, errors, { allowTrailingComma: true });
    if (errors.length || ![0, 1].includes(lock?.lockfileVersion))
      throw new Error("Unsupported or invalid Bun text lockfile");
    if (Object.keys(lock.workspaces ?? {}).some((key) => key !== ""))
      throw new Error("Bun workspace locks are unsupported");
    for (const entry of Object.values(lock.packages ?? {}) as unknown[][]) {
      if (
        !Array.isArray(entry) ||
        typeof entry[0] !== "string" ||
        !semver.valid(entry[0].match(/^(?:@[^/]+\/)?[^@]+@(.+)$/)?.[1] ?? "") ||
        (entry[1] !== "" && !publicTarball(entry[1]))
      )
        throw new Error("Bun locks must contain public registry packages only");
    }
    for (const section of sections) {
      if (
        JSON.stringify(
          Object.entries(lock.workspaces?.[""]?.[section] ?? {}).sort(),
        ) !== JSON.stringify(Object.entries(manifest[section] ?? {}).sort())
      ) {
        throw new Error("Bun lockfile declarations differ from the manifest");
      }
    }
    for (const section of sections)
      for (const [name, declared] of Object.entries(manifest[section] ?? {})) {
        if (lock.workspaces?.[""]?.[section]?.[name] !== declared)
          throw new Error(
            `Bun lockfile declarations differ from the manifest: ${name}`,
          );
        const resolved = lock.packages?.[name]?.[0];
        if (typeof resolved !== "string" || !resolved.startsWith(`${name}@`))
          throw new Error(`Missing Bun package resolution: ${name}`);
        versions[name] = resolved.slice(name.length + 1);
      }
  } else throw new Error(`Unsupported lockfile: ${filename}`);
  return versions;
};

/** Restore declaration ranges after the native manager resolves an exact temporary pin. */
export const restoreLockDeclarations = (
  lock: PackageLock,
  content: string,
  manifest: Manifest,
  finding: { package: string; targetVersion: string },
): string => {
  const name = finding.package;
  const sections = ["dependencies", "devDependencies"] as const;
  if (lock.manager === "bun") {
    for (const section of sections)
      if (manifest[section]?.[name]) {
        content = applyEdits(
          content,
          modify(
            content,
            ["workspaces", "", section, name],
            manifest[section][name],
            {},
          ),
        );
      }
    return content;
  }
  const parsed = parseSyml(content);
  if (lock.manager === "pnpm") {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declared =
      manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
    if (content.trimStart().startsWith("{")) {
      const json = JSON.parse(content);
      const importer = json.importers?.["."] ?? json;
      for (const section of sections)
        if (manifest[section]?.[name])
          importer[section][name].specifier = manifest[section][name];
      return JSON.stringify(json, null, 2) + "\n";
    }
    return content.replace(
      new RegExp(
        `^([ \t]+)(?:"${escapedName}"|'${escapedName}'|${escapedName}):\\r?\\n\\1  specifier:.*$`,
        "gm",
      ),
      (_entry, indent) =>
        `${indent}${name}:\n${indent}  specifier: ${JSON.stringify(declared)}`,
    );
  }
  const declarations = [
    ...new Set(
      sections.flatMap((section) =>
        manifest[section]?.[name] ? [manifest[section][name]] : [],
      ),
    ),
  ];
  const modern = Object.hasOwn(parsed, "__metadata");
  const exact = `${name}@${modern ? "npm:" : ""}${finding.targetVersion}`;
  const entry = Object.entries(parsed).find(([key]) =>
    key.split(/,\s*/).includes(exact),
  )?.[1];
  if (!entry) throw new Error(`Missing exact Yarn resolution: ${name}`);
  const aliases = new Map(
    declarations.map((declared) => [
      `${name}@${modern ? "npm:" : ""}${declared}`,
      entry,
    ]),
  );
  if (!modern) {
    // Preserve native Classic entry bodies; only selector headers need range aliases.
    return content.replace(
      /^([^\s#][^\n]*):\r?\n((?:[ \t].*(?:\r?\n|$)|\r?\n)*)/gm,
      (_block, header, body) => {
        const selectors = Object.keys(
          parseSyml(`# yarn lockfile v1\n${header}:\n  version "0.0.0"\n`),
        ).flatMap((selector) => selector.split(/,\s*/));
        const retained = selectors.filter((selector) => !aliases.has(selector));
        if (selectors.includes(exact)) retained.push(...aliases.keys());
        return retained.length
          ? `${[...new Set(retained)].map((selector) => JSON.stringify(selector)).join(", ")}:\n${body}`
          : "";
      },
    );
  }
  for (const [key, patched] of Object.entries(parsed)) {
    if (
      patched.resolution?.endsWith("@workspace:.") &&
      patched.dependencies?.[name]
    ) {
      patched.dependencies[name] =
        `npm:${manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]}`;
    }
    if (
      !patched.resolution ||
      !isBuiltinYarnPatch(patched.resolution, finding.targetVersion)
    )
      continue;
    for (const selector of key.split(/,\s*/)) {
      const patch = selector.match(
        /^(?:typescript|resolve|fsevents)@patch:([^#]+)#/,
      );
      if (
        !patch ||
        decodeURIComponent(patch[1]) !== `${name}@npm:${finding.targetVersion}`
      )
        continue;
      for (const declared of declarations)
        aliases.set(
          selector.replace(
            patch[1],
            patch[1].slice(0, -finding.targetVersion.length) + declared,
          ),
          patched,
        );
    }
  }
  for (const [selector, resolved] of aliases) {
    for (const key of Object.keys(parsed))
      if (key.split(/,\s*/).includes(selector)) {
        const remaining = key
          .split(/,\s*/)
          .filter((value) => value !== selector);
        const value = parsed[key];
        delete parsed[key];
        if (remaining.length) parsed[remaining.join(", ")] = value;
      }
    parsed[selector] = resolved;
  }
  return stringifySyml(parsed);
};
