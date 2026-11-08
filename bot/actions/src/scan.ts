import { readNpmLock, readRepositoryFile, updateManifest } from "./updates";
import semver from "semver";
import * as pep440 from "@renovatebot/pep440";
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

type JsonObject = Record<string, unknown>;

export type Dependency = {
  ecosystem: 'npm' | 'PyPI';
  package: string;
  declared: string;
  currentVersion: string;
  source: string;
  targetVersion?: string;
  releaseDate?: string;
};

const listFiles = (directory: string): string[] => {
  const tracked = new Set(execFileSync('git', ['-C', directory, 'ls-files', '-z', '--cached'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\0'));
  const untracked = execFileSync('git', ['-C', directory, 'ls-files', '-z', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\0');
  return [...new Set([...tracked, ...untracked])].filter((filename) => filename !== '' && !filename.split('/').some((part) =>
    ['node_modules', '.git', 'coverage', '.venv', 'venv', '__pycache__'].includes(part)
    || (!tracked.has(filename) && ['build', 'dist', 'vendor'].includes(part))));
};

const asObject = (value: unknown): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }

  return value as JsonObject;
};

const readJson = (path: string): JsonObject => {
  return asObject(JSON.parse(readFileSync(path, 'utf8')));
};

export const scanRepository = async (directory: string = process.cwd()): Promise<{
  root: string;
  dependencies: Dependency[];
  skipped: { project: string; package: string; reason: string }[];
}> => {
  const root = realpathSync(execFileSync(
    'git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' },
  ).trim());
  const dependencies: Dependency[] = [];
  const skipped: { project: string; package: string; reason: string }[] = [];
  const files = listFiles(root).sort();
  const safeFile = (filename: string): boolean => {
    const path = join(root, filename);
    if (!existsSync(path) || !lstatSync(path).isFile()) return false;
    const location = relative(root, realpathSync(path));
    return location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
  };

  for (const source of files) {
    if (!safeFile(source)) continue;
    const project = dirname(source);
    if (source === 'package.json' || source.endsWith('/package.json')) {
      const manifest = readJson(join(root, source));
      const entries = {
        ...asObject(manifest.dependencies ?? {}),
        ...asObject(manifest.devDependencies ?? {}),
      };
      let packages: JsonObject;
      try { packages = asObject(JSON.parse(readNpmLock(root, source)).packages ?? {}); }
      catch (error) {
        for (const name of Object.keys(entries)) skipped.push({ project, package: name,
          reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      for (const [name, declared] of Object.entries(entries)) {
        if (typeof declared !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
          || !/^[~^]?\d/.test(declared)) {
          skipped.push({ project, package: name, reason: 'Unsupported dependency name or specifier.' });
          continue;
        }
        // shortcut: action bundle builds pin their trusted builder; validate tooling before upgrading it.
        if (source === 'bot/actions/package.json' && name === 'esbuild') {
          skipped.push({ project, package: name, reason: 'Automatic action builder upgrades require separate toolchain validation.' });
          continue;
        }
        const locked = packages[`node_modules/${name}`];
        const current = locked !== undefined ? asObject(locked).version : undefined;
        // A manifest range is never evidence of an installed version.
        if (typeof current !== 'string' || semver.valid(current) === null) {
          skipped.push({ project, package: name, reason: 'Current version unavailable in the supported package-lock.json.' });
          continue;
        }
        const declarations = [asObject(manifest.dependencies ?? {})[name], asObject(manifest.devDependencies ?? {})[name]]
          .filter((value) => value !== undefined);
        if (!declarations.every((value) => typeof value === 'string' && semver.satisfies(current, value))) {
          skipped.push({ project, package: name, reason: 'Resolved version does not satisfy the manifest range.' });
          continue;
        }
        dependencies.push({ ecosystem: 'npm', package: name, declared, currentVersion: current, source });
      }
    } else if (/(?:^|\/)requirements(?:[-_.][^/]*)?\.txt$/.test(source)
      || /(?:^|\/)requirements\/.*\.txt$/.test(source)) {
      const lines = readFileSync(join(root, source), 'utf8').split(/\r?\n/);
      let continued = false;
      for (const raw of lines) {
        const continuation = /\\\s*$/.test(raw);
        const unsupported = continued || continuation || raw.includes('--hash');
        continued = continuation;
        const line = raw.replace(/\s+#.*$/, '').trim();
        if (!line || line.startsWith('#')) continue;
        if (unsupported) {
          skipped.push({ project, package: line.match(/^[A-Za-z0-9][A-Za-z0-9._-]*/)?.[0] ?? source,
            reason: 'Hashed or continued Python pins require lock regeneration.' });
          continue;
        }
        const requirement = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9_,. -]+\])?\s*==\s*([A-Za-z0-9][A-Za-z0-9.!+_-]*)(?=\s|;|$)/);
        if (!requirement) {
          skipped.push({ project, package: line.match(/^[A-Za-z0-9][A-Za-z0-9._-]*/)?.[0] ?? source,
            reason: 'Python dependency needs an exact == pin; includes, URLs, options and ranges are unsupported.' });
          continue;
        }
        const [, name, currentVersion] = requirement;
        if (pep440.valid(currentVersion) === null) {
          skipped.push({ project, package: name, reason: 'Invalid Python pinned version.' });
          continue;
        }
        const suffix = line.slice(requirement[0].length).trim();
        if (suffix && !suffix.startsWith(';') && !/^--hash=\S+(?:\s+--hash=\S+)*$/.test(suffix)) {
          skipped.push({ project, package: name, reason: 'Unsupported Python requirement suffix.' });
          continue;
        }
        dependencies.push({ ecosystem: 'PyPI', package: name.toLowerCase().replace(/[-_.]+/g, '-'),
          declared: line, currentVersion, source });
      }
    } else if (/(?:^|\/)(?:pyproject\.toml|Pipfile|setup\.py|setup\.cfg)$/.test(source)) {
      skipped.push({ project, package: source,
        reason: 'Python manifest is not resolved here; provide pinned requirements.txt or requirements/*.txt.' });
    }
  }
  const groups = new Map<string, Dependency>();
  for (const dependency of dependencies) {
    try {
      // Validate every declaration the shared updater will touch, without changing the file.
      updateManifest(readRepositoryFile(root, dependency.source), { ...dependency, targetVersion: dependency.currentVersion });
      const key = JSON.stringify([dependency.ecosystem, dependency.source, dependency.package, dependency.currentVersion]);
      const existing = groups.get(key);
      if (existing) existing.declared = [...new Set([...existing.declared.split('\n'), dependency.declared])].sort().join('\n');
      else groups.set(key, { ...dependency });
    } catch (error) {
      skipped.push({ project: dirname(dependency.source), package: dependency.package,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { root, dependencies: [...groups.values()], skipped };
};
