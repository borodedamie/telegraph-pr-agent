# ADR 0001: Deterministic registry-based cutoff detection

Status: Accepted
Date: 2026-10-19

## Context

The mission premise is "an agent that buys intelligence when it encounters something outside its training cutoff." The trigger for buying must be reproducible in front of judges (35% of scoring is mainnet-readiness/honesty) and testable as a binary acceptance criterion. Two credible mechanisms existed: ask the LLM whether it knows the referenced API (self-report), or compare the referenced package version's npm release date against a configured `modelCutoff` constant (deterministic).

## Decision

Use the deterministic registry check: parse dependency changes from the PR diff, resolve the version's release date from the npm registry, and fire the buy pipeline only when `release_date > modelCutoff`. Model self-report uncertainty detection is excluded from v1.

## Consequences

- Positive: trigger is reproducible on demand, cold-demo-proof, and yields a hard AC (pre-cutoff PRs must spend zero); `modelCutoff` is a config value, matching the mainnet-ready discipline.
- Negative: less narratively "agentic" — mitigated by quoting the model's documented cutoff in the PR memo.
- Negative: only catches dependency-version changes, not arbitrary unknown APIs or language features — accepted within demo scope (seeded repo with planted PRs).
- Follow-up constraint: any future self-report trigger must not replace the deterministic path, only extend it.
