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
};

const listFiles = (directory: string): string[] => {
  return [...new Set(execFileSync(
    'git',
    ['-C', directory, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  ).split('\0'))].filter((filename) => {
    return filename !== '' && !filename.split('/').some((part) => {
      return ['node_modules', '.git', 'dist', 'build', 'coverage', 'vendor', '.venv', 'venv', '__pycache__'].includes(part);
    });
  });
};

const pnpmVersion = (directory: string, root: string, name: string): unknown => {
  const lockPath = join(root, 'pnpm-lock.yaml');

  if (!existsSync(lockPath)) {
    return undefined;
  }

  const importer = relative(root, directory).split(sep).join('/') || '.';
  let inImporters = false;
  let inProject = false;
  let inDependencies = false;
  let inPackage = false;

  const unquote = (value: string): string => {
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1).replaceAll("''", "'");
    }

    return value.startsWith('"') ? JSON.parse(value) : value;
  };

  // Read only pnpm's block-style importer versions, not general YAML.
  for (const line of readFileSync(lockPath, 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inImporters = line === 'importers:';
      continue;
    }

    if (!inImporters) {
      continue;
    }

    const project = line.match(/^  (\S.*):(?:\s*\{\})?\s*$/);

    if (project) {
      inProject = unquote(project[1]) === importer;
      inDependencies = false;
      inPackage = false;
    } else if (inProject && /^    \S/.test(line)) {
      inDependencies = /^    (?:dependencies|devDependencies):\s*$/.test(line);
      inPackage = false;
    } else if (inProject && inDependencies) {
      const dependency = line.match(/^      (\S.*):\s*$/);

      if (dependency) {
        inPackage = unquote(dependency[1]) === name;
      } else if (inPackage) {
        const version = line.match(/^        version: (.+?)\s*$/);

        if (version) {
          return unquote(version[1]).split('(')[0];
        }
      }
    }
  }

  return undefined;
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
    const directory = join(root, project);
    if (source === 'package.json' || source.endsWith('/package.json')) {
      const manifest = readJson(join(root, source));
      const entries = {
        ...asObject(manifest.dependencies ?? {}),
        ...asObject(manifest.devDependencies ?? {}),
      };
      const lockDirectory = existsSync(join(directory, 'package-lock.json')) ? directory : root;
      const lockPath = join(lockDirectory, 'package-lock.json');
      const packages = existsSync(lockPath) ? asObject(readJson(lockPath).packages ?? {}) : {};
      const prefix = relative(lockDirectory, directory).split(sep).join('/');
      for (const [name, declared] of Object.entries(entries)) {
        if (typeof declared !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
          || /^(?:workspace:|file:|link:|git|https?:|npm:)/.test(declared)) {
          skipped.push({ project, package: name, reason: 'Unsupported dependency name or specifier.' });
          continue;
        }
        const locked = packages[`${prefix ? `${prefix}/` : ''}node_modules/${name}`]
          ?? packages[`node_modules/${name}`];
        const installedPath = [join(directory, 'node_modules', name, 'package.json'),
          join(root, 'node_modules', name, 'package.json')].find((path) => existsSync(path));
        const current = locked !== undefined ? asObject(locked).version
          : installedPath ? readJson(installedPath).version : pnpmVersion(directory, root, name);
        // A manifest range is never evidence of an installed version.
        if (typeof current !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(current)) {
          skipped.push({ project, package: name, reason: 'Current version unavailable in a supported lockfile or node_modules.' });
          continue;
        }
        dependencies.push({ ecosystem: 'npm', package: name, declared, currentVersion: current, source });
      }
    } else if (/(?:^|\/)requirements(?:[-_.][^/]*)?\.txt$/.test(source)
      || /(?:^|\/)requirements\/.*\.txt$/.test(source)) {
      const lines = readFileSync(join(root, source), 'utf8').replace(/\\\r?\n/g, ' ').split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.replace(/\s+#.*$/, '').trim();
        if (!line || line.startsWith('#')) continue;
        const requirement = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9_,. -]+\])?\s*==\s*([A-Za-z0-9][A-Za-z0-9.!+_-]*)(?=\s|;|$)/);
        if (!requirement) {
          skipped.push({ project, package: line.match(/^[A-Za-z0-9][A-Za-z0-9._-]*/)?.[0] ?? source,
            reason: 'Python dependency needs an exact == pin; includes, URLs, options and ranges are unsupported.' });
          continue;
        }
        const [, name, currentVersion] = requirement;
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
  return { root, dependencies, skipped };
};
