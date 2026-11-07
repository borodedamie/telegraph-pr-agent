import { execFileSync, spawn } from 'node:child_process';
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

const listFiles = async (directory: string): Promise<string[]> => {
  const manifests = new Set<string>();
  // Tracked manifests are source even under names such as build or vendor.
  for (const tracked of [true, false]) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['-C', directory, 'ls-files', '-z',
        ...(tracked ? ['--cached'] : ['--others', '--exclude-standard']), '--', '.']);
      let pending = '';
      let error = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        const paths = (pending + chunk).split('\0');
        pending = paths.pop()!;
        for (const filename of paths) {
          if (filename !== 'package.json' && !filename.endsWith('/package.json')) continue;
          const excluded = tracked ? ['node_modules', '.git']
            : ['node_modules', '.git', 'dist', 'build', 'coverage', 'vendor'];
          if (!filename.split('/').some((part) => excluded.includes(part))) manifests.add(filename);
        }
      });
      child.stderr.on('data', (chunk: string) => { error = (error + chunk).slice(-4000); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Git file listing failed (${code}): ${error}`)));
    });
  }
  return [...manifests];
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

export class RegistryError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const fetchJson = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonObject> => {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });

  if (!response.ok) {
    throw new RegistryError(`Request failed with HTTP ${response.status}: ${url}`, response.status);
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
  root = realpathSync(root);
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

    let lookup = directory;
    let installed: unknown;
    while (true) {
      const prefix = relative(lockDirectory, lookup).split(sep).join('/');
      const locked = lockPackages[`${prefix ? `${prefix}/` : ''}node_modules/${name}`];
      if (locked !== undefined) { installed = asObject(locked).version; break; }
      if (lookup === lockDirectory) break;
      const parent = dirname(lookup);
      if (parent === lookup) break;
      lookup = parent;
    }
    lookup = directory;
    while (installed === undefined) {
      const installedPath = join(lookup, 'node_modules', name, 'package.json');
      if (existsSync(installedPath)) { installed = readJson(installedPath).version; break; }
      if (lookup === root) break;
      const parent = dirname(lookup);
      if (parent === lookup) break;
      lookup = parent;
    }
    if (installed === undefined) installed = pnpmVersion(directory, root, name);

    if (!stableVersion(installed)) {
      skipped.push({ package: name, reason: 'Stable installed version unavailable in a supported lockfile or node_modules.' });
      continue;
    }

    let metadata: JsonObject;
    try {
      metadata = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, fetchImpl);
    } catch (error) {
      if (error instanceof RegistryError && error.status === 404) {
        skipped.push({ package: name, reason: 'Package not found in the public npm registry.' });
        continue;
      }
      throw error;
    }

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
  const repositoryRoot = realpathSync(findRepositoryRoot(root));
  const manifests = (await listFiles(root)).filter((filename) => {
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
    const scan = await scanCodebase(projectDirectory, selectedPackage, cachedFetch, repositoryRoot);

    skipped.push(...scan.skipped.map((entry) => ({ project, ...entry })));

    for (const candidate of scan.candidates) {
      const existing = candidates.find((entry) => {
        return entry.package === candidate.package && entry.installed === candidate.installed
          && entry.declared === candidate.declared;
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

