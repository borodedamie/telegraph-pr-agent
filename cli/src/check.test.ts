import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanRepository } from './check.ts';

test('scans tracked source, large manifests and scoped hoisted versions with distinct ranges', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cli-check-'));
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  };
  try {
    execFileSync('git', ['init', '-q', root]);
    const dependencies = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`pkg${i}`, '^1.0.0']));
    write('package.json', { dependencies });
    write('packages/build/package.json', { dependencies: { foo: '^1.0.0' } });
    write('packages/nested/project/package.json', { dependencies: { foo: '~1.0.0' } });
    write('package-lock.json', { packages: {
      ...Object.fromEntries(Object.keys(dependencies).map((name) => [`node_modules/${name}`, { version: '1.0.0' }])),
      'node_modules/foo': { version: '2.0.0' },
      'packages/node_modules/foo': { version: '1.0.0' },
    } });
    execFileSync('git', ['-C', root, 'add', '.']);
    write('vendor/generated/package.json', { dependencies: { ignored: '1.0.0' } });
    const fetchImpl: typeof fetch = async (input) => new Response(JSON.stringify({
      name: decodeURIComponent(String(input).split('/').at(-2)!), version: '3.0.0',
    }));
    const scan = await scanRepository(root, undefined, fetchImpl);
    assert.equal(scan.candidates.length, 103);
    assert(!scan.projects.includes('vendor/generated'));
    assert(scan.projects.includes('packages/build'));
    const foo = scan.candidates.filter((entry) => entry.package === 'foo');
    assert.equal(foo.length, 2);
    assert(foo.every((entry) => entry.installed === '1.0.0'));
    const scoped = await scanRepository(join(root, 'packages/nested'), undefined, fetchImpl);
    assert.equal(scoped.candidates[0].installed, '1.0.0');
    assert.deepEqual(scoped.projects, ['project']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('streams Git path lists larger than the previous buffer limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cli-paths-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    writeFileSync(join(root, 'package.json'), '{}');
    const blob = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: '' }).toString().trim();
    const entries = Array.from({ length: 20000 }, (_, i) => `100644 ${blob}\t${String(i).padStart(5, '0')}${'x'.repeat(220)}\0`).join('');
    execFileSync('git', ['-C', root, 'update-index', '-z', '--index-info'], { input: entries });
    const scan = await scanRepository(root);
    assert.deepEqual(scan.projects, ['.']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
