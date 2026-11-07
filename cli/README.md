# Telegraph PR Agent CLI

Dependency version checker written in TypeScript with no dependencies. Requires
Node.js 22.6 or newer and Git. Node's built-in type stripping runs the source
without a build step; it does not type-check code.

Run from `cli` without installing packages:

```bash
npm start -- check
npm start -- check --package zod
npm start -- --help
npm start -- --version
```

`check` automatically finds the Git repository root and checks direct
dependencies and dev dependencies in every Git-listed `package.json`, including
nested projects and workspaces. No path is required. An optional directory scopes
the check to that subtree. Untracked files are included unless ignored. Generated
directories (`node_modules`, `dist`, `build`, `coverage`, and `vendor`) are excluded
for untracked files; tracked source manifests under `build` or `vendor` are included.

Installed versions come from npm v2/v3 lockfiles, including hoisted workspace
entries from the Git root even for scoped scans, `node_modules`, or pnpm block-style importer versions. Peer suffixes in
pnpm versions are removed; unsupported YAML forms are not parsed. Yarn projects
require installed dependencies. Manifest ranges are never treated as installed
versions. Local, workspace, git and alias dependencies and non-stable installed
versions are skipped with a reason.

The checker fetches each dependency's latest version from the npm registry and
compares stable versions numerically. Output is JSON with `root`, `projects`,
`updates`, and `skipped`. Each update includes the package name, declared range,
installed version, latest version, and affected projects. Matching package/version/range
triples across projects are combined. Registry results are cached within each run.
Current versions and unsupported dependencies appear in `skipped` with reasons.
Packages returning HTTP 404 from the public registry are skipped with a reason.
Other registry failures exit with an error rather than reporting packages as current.

The command only checks version availability. It does not assess migration safety,
scan source contents, call Telegraph, make payments, or change package files.
No API keys or wallet configuration are required. All functions use const arrow
syntax. This package runs independently from the root pnpm workspace.
