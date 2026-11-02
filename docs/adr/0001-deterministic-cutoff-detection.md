# ADR 0001: Deterministic registry-based cutoff detection

Status: Accepted; trigger amended 2026-11-02 (see Amendment)
Date: 2026-10-19

## Context

The mission premise is "an agent that buys intelligence when it encounters something outside its training cutoff." The trigger for buying must be reproducible in front of judges and testable as a binary acceptance criterion. Two credible mechanisms existed: ask the LLM whether it knows the referenced API (self-report), or compare the referenced package version's npm release date against a configured `MODEL_CUTOFF` (deterministic).

## Decision

Use the deterministic registry check: parse dependency changes from the PR diff, resolve the version's release date from the npm registry, and fire the buy pipeline only when `release_date > MODEL_CUTOFF`. Model self-report uncertainty detection is excluded from v1.

## Consequences

- Positive: the trigger is reproducible under pinned fixture data and yields a hard acceptance criterion (pre-cutoff changes spend zero). A live registry lookup that fails or returns missing metadata fails closed. `MODEL_CUTOFF` is a config value.
- Negative: less narratively "agentic"; mitigated by quoting the model's documented cutoff in the PR.
- Negative: only catches dependency-version changes, not arbitrary unknown APIs or language features.
- A release date after the cutoff is a proxy, not proof that the model does not know the release. The classification is `post_cutoff_candidate`, and the PR shows the cutoff's provenance: provider, exact model id, date, source URL, and whether it is provider-documented or team-assumed.
- Follow-up constraint: any future self-report signal may extend the deterministic path but never bypass it or add spending without its own policy and ADR.

## Amendment, 2026-11-02: trigger

The team decided the GitHub Action does not react to human PR diffs: by then the developer has already bumped the dependency, so the bot has nothing useful to add. The PR-diff trigger above now describes only the CLI v0 prototype (`bot/src/slice.ts`), which is kept as a prototype and is not represented as implementing the rule below.

For the Action (v1):

- Runs on a schedule the developer sets in their workflow file (`on: schedule` cron; our example uses weekly) and on manual `workflow_dispatch`.
- Scans the default branch:

```text
A = installed version from the supported lockfile (package-lock.json v2/v3)
B = latest stable version from registry metadata (prereleases excluded)
Eligible = semver(B) > semver(A) AND registryReleaseDate(B) > MODEL_CUTOFF
```

- Missing lockfile, unsupported lockfile, or missing release dates fail closed with a diagnostic. Full rules: [SPEC §2.3](../SPEC.md).
