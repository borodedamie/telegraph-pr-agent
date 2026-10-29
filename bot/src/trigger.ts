export interface CutoffTrigger {
  package: string;
  version: string;
  releaseDate: string | null;
  status: "past-cutoff" | "unverifiable";
}

// package.json holds range specs ("^4.6.7"), but registry.time is keyed by the
// bare version that was published ("4.6.7"). Resolve the spec to that key.
function bareVersion(spec: string): string {
  const m = spec.match(/\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?/);
  return m ? m[0] : spec;
}

function depsOf(packageJson: string): Record<string, string> {
  const parsed = JSON.parse(packageJson) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
}

export async function detectCutoffTriggers(
  pr: { basePackageJson: string; headPackageJson: string },
  modelCutoff: Date,
  fetchImpl: typeof fetch = fetch
): Promise<CutoffTrigger[]> {
  const base = depsOf(pr.basePackageJson);
  const head = depsOf(pr.headPackageJson);

  const changed = Object.entries(head).filter(([name, version]) => base[name] !== version);
  if (changed.length === 0) return [];

  const triggers: CutoffTrigger[] = [];
  for (const [name, version] of changed) {
    const unverifiable = (): void => {
      triggers.push({ package: name, version, releaseDate: null, status: "unverifiable" });
    };

    const res = await fetchImpl(`https://registry.npmjs.org/${name}`);
    if (!res.ok) {
      unverifiable();
      continue;
    }
    const registry = (await res.json()) as { time?: Record<string, string> };
    const releaseDate = registry.time?.[bareVersion(version)];
    if (!releaseDate) {
      unverifiable();
      continue;
    }
    if (new Date(releaseDate) > modelCutoff) {
      triggers.push({ package: name, version, releaseDate, status: "past-cutoff" });
    }
  }
  return triggers;
}
