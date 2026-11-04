import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

type JsonObject = Record<string, unknown>;

export type Candidate = {
  package: string;
  declared: string;
  installed: string;
  latest: string;
  projects?: string[];
};

export const findRepositoryRoot = (directory: string): string => {
  return execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
};

const listFiles = (directory: string): string[] => {
  return [...new Set(execFileSync(
    'git',
    ['-C', directory, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  ).split('\0'))].filter((filename) => {
    return filename !== '' && !filename.split('/').some((part) => {
      return ['node_modules', '.git', 'dist', 'build', 'coverage', 'vendor'].includes(part);
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

export const asObject = (value: unknown): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }

  return value as JsonObject;
};

const readJson = (path: string): JsonObject => {
  return asObject(JSON.parse(readFileSync(path, 'utf8')));
};

const stableVersion = (value: unknown): value is string => {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
};

const isNewer = (latest: string, installed: string): boolean => {
  const previous = installed.split('.').map(BigInt);
  const next = latest.split('.').map(BigInt);

  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== previous[index]) {
      return next[index] > previous[index];
    }
  }

  return false;
};

export const fetchJson = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonObject> => {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }

  return asObject(await response.json());
};

export const scanCodebase = async (
  directory: string,
  selectedPackage?: string,
  fetchImpl: typeof fetch = fetch,
  root: string = directory,
): Promise<{ candidates: Candidate[]; skipped: { package: string; reason: string }[] }> => {
  directory = realpathSync(directory);
  const manifest = readJson(join(directory, 'package.json'));
  const dependencies = {
    ...asObject(manifest.dependencies ?? {}),
    ...asObject(manifest.devDependencies ?? {}),
  };
  const entries = Object.entries(dependencies).filter(([name]) => {
    return !selectedPackage || name === selectedPackage;
  });

  if (selectedPackage && entries.length === 0) {
    throw new Error(`${selectedPackage} is not a direct dependency in this directory.`);
  }

  if (entries.length > 100) {
    throw new Error('More than 100 direct dependencies. Use --package to narrow the check.');
  }

  const localLockPath = join(directory, 'package-lock.json');
  const lockDirectory = existsSync(localLockPath) ? directory : root;
  const lockPath = join(lockDirectory, 'package-lock.json');
  const lock = existsSync(lockPath) ? readJson(lockPath) : {};
  const lockPackages = asObject(lock.packages ?? {});
  const candidates: Candidate[] = [];
  const skipped: { package: string; reason: string }[] = [];

  for (const [name, declared] of entries) {
    if (
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
      typeof declared !== 'string' ||
      /^(?:workspace:|file:|link:|git|https?:|npm:)/.test(declared)
    ) {
      skipped.push({ package: name, reason: 'Unsupported dependency name or specifier.' });
      continue;
    }

    const workspacePrefix = relative(lockDirectory, directory).split(sep).join('/');
    const locked = lockPackages[`${workspacePrefix ? `${workspacePrefix}/` : ''}node_modules/${name}`]
      ?? lockPackages[`node_modules/${name}`];
    const installedPath = join(directory, 'node_modules', name, 'package.json');
    let installed: unknown;

    if (locked !== undefined) {
      installed = asObject(locked).version;
    } else if (existsSync(installedPath)) {
      installed = readJson(installedPath).version;
    } else if (existsSync(join(root, 'node_modules', name, 'package.json'))) {
      installed = readJson(join(root, 'node_modules', name, 'package.json')).version;
    } else {
      installed = pnpmVersion(directory, root, name);
    }

    if (!stableVersion(installed)) {
      skipped.push({ package: name, reason: 'Stable installed version unavailable in a supported lockfile or node_modules.' });
      continue;
    }

    const metadata = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, fetchImpl);

    if (metadata.name !== name || !stableVersion(metadata.version)) {
      skipped.push({ package: name, reason: 'Registry did not return a matching stable package version.' });
      continue;
    }

    if (!isNewer(metadata.version, installed)) {
      skipped.push({ package: name, reason: 'Installed version is current or newer than latest stable.' });
      continue;
    }

    candidates.push({
      package: name,
      declared,
      installed,
      latest: metadata.version,
    });
  }

  return { candidates, skipped };
};

export const scanRepository = async (
  directory: string,
  selectedPackage?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  root: string;
  projects: string[];
  candidates: Candidate[];
  skipped: { project: string; package: string; reason: string }[];
}> => {
  const root = realpathSync(directory);
  const manifests = listFiles(root).filter((filename) => {
    return filename === 'package.json' || filename.endsWith('/package.json');
  }).filter((filename) => {
    const path = join(root, filename);

    if (!existsSync(path) || !lstatSync(path).isFile()) {
      return false;
    }

    const location = relative(root, realpathSync(path));

    return location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
  }).sort();

  if (manifests.length === 0) {
    throw new Error('No package.json files found in this codebase.');
  }

  const candidates: Candidate[] = [];
  const skipped: { project: string; package: string; reason: string }[] = [];
  const projects: string[] = [];
  const registryCache = new Map<string, string>();
  const cachedFetch: typeof fetch = async (input, init) => {
    const key = String(input);
    const cached = registryCache.get(key);

    if (cached !== undefined) {
      return new Response(cached, { headers: { 'Content-Type': 'application/json' } });
    }

    const response = await fetchImpl(input, init);

    if (response.ok) {
      registryCache.set(key, await response.clone().text());
    }

    return response;
  };
  let packageFound = false;

  for (const manifestPath of manifests) {
    const project = dirname(manifestPath);
    const projectDirectory = join(root, project);
    const manifest = readJson(join(root, manifestPath));
    const dependencies = {
      ...asObject(manifest.dependencies ?? {}),
      ...asObject(manifest.devDependencies ?? {}),
    };

    projects.push(project);

    if (selectedPackage && !(selectedPackage in dependencies)) {
      continue;
    }

    packageFound = true;
    const scan = await scanCodebase(projectDirectory, selectedPackage, cachedFetch, root);

    skipped.push(...scan.skipped.map((entry) => ({ project, ...entry })));

    for (const candidate of scan.candidates) {
      const existing = candidates.find((entry) => {
        return entry.package === candidate.package && entry.installed === candidate.installed;
      });

      if (existing) {
        existing.projects?.push(project);
      } else {
        candidates.push({ ...candidate, projects: [project] });
      }
    }
  }

  if (selectedPackage && !packageFound) {
    throw new Error(`${selectedPackage} is not a direct dependency in this codebase.`);
  }

  return { root, projects, candidates, skipped };
};

