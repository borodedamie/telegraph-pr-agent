# Implementation Plan: Package-release miner

**Branch**: `miner_init` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `miner/specs/001-package-release-miner/spec.md`

## Summary

The miner is an HTTPS service with one endpoint, served only to requests carrying Telegraph's key. It takes a free-form question about an npm package upgrade and returns an evidence-backed migration answer: breaking changes, deprecations and security fixes, each with a verbatim excerpt from version-matched release material. It also lists OSV advisories that the upgrade does or does not fix, and states complete or partial coverage.

Resolution, sourcing and verification are deterministic. A language model only classifies and extracts items from already-retrieved, version-specific text, and every excerpt it returns must be an exact substring of that text. A source manifest tells which sources changed. Answers are cached by request, source hashes and processing version, so repeats are byte-identical, and the text behind every hash is kept as a snapshot. Upstream outages are declared to Telegraph as failures, so they are not charged. The service is registered on Telegraph's canonical QA intent.

## Technical Context

**Language/Version**: TypeScript 5, Node.js 20+ (same as `bot/`)

**Primary Dependencies**:
- `zod` for boundary validation;
- `semver` for version resolution;
- `@x402/fetch`, `@x402/evm` and `viem`, as in `bot/`, to buy LLM extraction from a Telegraph LLM miner behind the `ChangeExtractor` interface ([R7](research.md));
- `@upstash/redis` for the cache.

HTTP uses Node's built-in `fetch`, wrapped in `safeFetch`, and the server is a Vercel Node function. No web framework.

**Storage**: Upstash Redis via the Vercel Marketplace: a source snapshot cache and an answer cache ([research R3](research.md)). An in-memory fallback runs locally.

**Testing**: vitest. Unit tests for resolver, matcher, extractor verification, correlation and `safeFetch`; fixture tests with recorded upstream responses; a benchmark harness for the 30 + 10 set (SC-001 to SC-006).

**Target Platform**: Vercel Functions, Node.js runtime, Hobby plan with Fluid compute: 300 s maximum duration, 2 GB memory, 4.5 MB response body; our own `maxDuration: 30`. Functions in `api/` are served under `/api/`, so the YAML maps Telegraph's `/answer` to `external_path: /api/answer`. Hobby is non-commercial only: confirm eligibility before production registration ([R2](research.md)).

**Project Type**: Web service (single endpoint plus health), as a new pnpm workspace package `miner`.

**Performance Goals**:
- repeat requests under 0.5 s at p95;
- first-time requests under 2 s where the live intent requires it, otherwise p50/p95 published (SC-006).

**Constraints**:
- per-request budgets from [R9](research.md), including model calls (one per first-time answer), input size, cost and timeout;
- origin authentication and rate limits ([R10](research.md));
- fetches only to allowlisted hosts, connecting to the validated address;
- no package execution;
- the model never supplies versions, dates or links.

**Scale/Scope**: hackathon traffic, tens to low thousands of requests per day; about 30 popular packages pre-warmed for the benchmark and demo.

## Constitution Check

`miner/.specify/memory/constitution.md` is still the unfilled spec-kit template, so the gates come from the repository's [AGENTS.md](../../../AGENTS.md).

| Gate (AGENTS.md) | Status |
| --- | --- |
| KISS; no abstraction before the third use | Pass. One endpoint, plain functions. The only interface, `ChangeExtractor`, has two real implementations: deterministic and model. |
| Never commit secrets | Pass. Keys, including `MINER_API_KEY`, live in `miner/.env` (gitignored by `.env*`) and Vercel env vars. The YAML only names the header. |
| No paid Telegraph call or payment signing without approval | Pass. Registration, key installation and the acceptance-test purchases are separate, explicitly approved steps (tasks marked ⚠). At runtime the deployed miner buys LLM calls itself, with test USDC from its own capped spend wallet; turning that on in production is an approved step (T060). Development and tests never buy: the LLM miner is stubbed. |
| Miner/release text is untrusted input | Pass. FR-020 is enforced by `safeFetch`, verbatim excerpt checks, and a model that only ever sees data. |
| No silent failures | Pass. Every upstream error maps to an explicit outcome or a coverage gap. |
| New dependencies need approval and a reason | Approved 3 Nov: `semver`, `@upstash/redis`, and the x402 client already used by `bot/`. Reasons are in the Complexity Tracking table below. |
| Docs in sync | Pass, with one task: [docs/SPEC.md](../../../docs/SPEC.md) §3 must gain a pointer to this spec in the same PR, so the miner has one source of truth. |

Post-design re-check: no new violations. Dependency approval is the only open gate.

## Project Structure

### Documentation (this feature)

```text
miner/specs/001-package-release-miner/
├── spec.md
├── plan.md              # this file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── answer-endpoint.md
│   └── telegraph-miner.yaml   # draft registration file
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
miner/
├── package.json         # @telegraph-pr-agent/miner
├── tsconfig.json
├── vercel.json
├── .env.example
├── api/
│   ├── answer.ts        # Vercel function: GET /api/answer (Telegraph path /answer)
│   └── health.ts        # GET /api/health
├── src/
│   ├── types.ts         # zod schemas from data-model.md
│   ├── auth.ts          # X-Telegraph-Key check, origin rate and concurrency limits
│   ├── parse.ts         # query → NormalizedRequest (unresolved)
│   ├── resolve.ts       # npm registry + semver → resolved versions
│   ├── safeFetch.ts     # allowlist, DNS/IP checks, manual redirects, size and time limits
│   ├── sources/
│   │   ├── github.ts    # repo identity, releases, changelog
│   │   ├── compare.ts   # tag-comparison fallback: bounded patches, repository evidence
│   │   ├── match.ts     # tag/heading → version correspondence (monorepo-aware)
│   │   └── osv.ts       # advisories for version A, full affected data
│   ├── extract/
│   │   ├── rules.ts     # deterministic section and CVE/GHSA extraction
│   │   ├── model.ts     # LLM extraction bought from a Telegraph LLM miner, paid from escrow; zod-validated output, circuit breaker
│   │   └── verify.ts    # normalization + exact-substring check for excerpts and migration steps
│   ├── affected.ts      # is version V affected by an OSV record (all ranges, events, versions)
│   ├── correlate.ts     # advisories × documented fixes → conclusions
│   ├── coverage.ts      # releases between A and B; covered and not covered (US1)
│   ├── probe.ts         # cached upstream probes for /api/health
│   ├── outcome.ts       # outcome selection and the deterministic confidence bands
│   ├── answer.ts        # pipeline orchestration
│   ├── render.ts        # Answer → plain-text `answer` field
│   ├── cache.ts         # source manifest, snapshots, answer cache, in-flight lock; Redis or memory
│   ├── budget.ts        # per-request budget tracker
│   └── metrics.ts       # per-request metrics record
├── test/
│   ├── unit/
│   └── fixtures/        # recorded registry, GitHub and OSV responses
└── bench/
    ├── transitions.json # 30 reviewed transitions + 10 negative cases
    ├── run.ts           # benchmark harness → report.md
    └── network.md       # network acceptance test log
```

**Structure Decision**: `miner/` is a standalone pnpm workspace package next to `bot/` and `web/`. It does not import `bot/`. The PR bot calls the miner only over Telegraph. Add `miner` to `pnpm-workspace.yaml`.

## Implementation phases

These follow the second review's order. Each phase has an exit condition, and a phase starts only when the previous exit holds, except where noted.

| # | Phase | Exit condition |
| --- | --- | --- |
| 1 | Telegraph contract, before registration | Intent definition read live; YAML passes the official validator; the dashboard sandbox request to our stub is recorded; the Engine timeout for the intent is known. R1 confirmed or corrected. No registration needed |
| 2 | API security and hosting | `/api/answer` and `/api/health` deployed; unauthenticated calls get `401`; rate and concurrency limits work; Hobby eligibility answered |
| 3 | npm resolver | Exact package and version resolution passes unit tests, including scoped names, ranges and all FR-004 defaults, 0.x included |
| 4 | Source retrieval | Correct version-specific material for the benchmark packages: releases, changelog sections, monorepo tags and the tag-comparison fallback |
| 5 | Evidence extraction | Every change and every documented migration step has a verified excerpt; unsupported steps are `inferred` or `manual_review` |
| 6 | OSV | Affected/fixed for A and B decided from complete OSV data, including multi-range records; check status reported |
| 7 | Outcomes and coverage | Negative cases, partial coverage and the simulated outage return the right outcome |
| 8 | Cache and budgets | Manifest → hashes → answer cache order works; snapshots persisted; repeats byte-identical; total model call/token/cost limits enforced; metrics recorded |
| 9 | Quality benchmark | SC-001 to SC-006, SC-008 and SC-012 pass on the 30 + 10 set, excluding only jumps that exceed the US1 budget (more than `MAX_MODEL_RELEASES` releases needing the model), and first-time cost fits the price. This gates registration. The excluded large jumps are added once US3 works |
| 10 | Registration ⚠ | Miner active; key installed; a direct and an Engine-routed purchase deliver an answer and a receipt; the real routed request captured |
| 11 | Ranking check | Routing eligibility, score and rank recorded from the three endpoints in R12, or documented as unavailable with the reason |
| 12 | PR bot integration | One migration using the miner's answer passes the repository's tests |
| 13 | External adoption | One purchase by an unrelated agent with receipt, signal and settlement evidence |

Phases 3–8 can be developed against fixtures while phases 1–2 wait on deployment. Register after US1 (including coverage of every release between A and B), US2 and US4 work. US3 (large jumps within budget) may follow, because until then a jump beyond the budget is reported as partial coverage with the cut releases named, never as complete. Phase 11 never blocks 12 or 13.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| `semver` dependency | Correct range resolution and ordering, including prereleases | Hand-written comparison gets prerelease and range edge cases wrong |
| `@x402/fetch`, `@x402/evm`, `viem` | Buying LLM extraction on Telegraph with test USDC, so the hackathon costs no real money | A direct LLM API needs a paid key; rules alone miss changes written as prose. Same packages and versions as `bot/` |
| `@upstash/redis` dependency | Shared cache across serverless instances (FR-018, FR-019, SC-006) | An in-memory cache is lost between invocations |
