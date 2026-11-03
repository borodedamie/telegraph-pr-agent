# Data model: Package-release miner

All types are validated with zod at the boundaries (incoming query, every upstream response, model output, outgoing answer).

## NormalizedRequest

| Field | Type | Rule |
| --- | --- | --- |
| `ecosystem` | `"npm"` | Only npm in v1 (FR-002) |
| `package` | string | Exact registry name, scoped names allowed; never substituted (FR-003) |
| `fromRequested` | string \| null | As written in the question |
| `toRequested` | string \| null | As written in the question |
| `fromResolved` | semver string \| null | Resolved against the registry |
| `toResolved` | semver string \| null | Resolved against the registry |
| `fromAssumed` | boolean | True when the FR-004 default was applied |

**Answer identity** (part of the answer-cache key): the canonical JSON of the whole `NormalizedRequest`. The requested strings and `fromAssumed` are included because they change the answer's text: "3.23.8 → 4.0.0" asked explicitly and "4.0.0" with an assumed 3.23.8 resolve to the same pair but must not share a cached answer.

## ReleaseSource

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | `s1`, `s2`, … within one answer |
| `type` | `registry` \| `release` \| `changelog` \| `tag_compare` \| `advisory` | |
| `url` | string | The URL actually fetched (FR-009) |
| `retrievedAt` | ISO timestamp | |
| `versionFrom` | string \| null | Range the material applies to |
| `versionTo` | string \| null | Null for `advisory` |
| `contentHash` | sha256 hex | Over the whole normalized document as fetched. For the registry, over the canonical JSON of only the fields used (`versions` keys, `time`, `dist-tags`, `repository`). For OSV, over the normalized response of one query (FR-019) |
| `snapshotKey` | string | `snap:<contentHash>`: the persistent snapshot of that same document. Version sections (one release, one changelog section) are derived from it deterministically, never stored as separate hashes |
| `trust` | `official` \| `repository_evidence` \| `advisory_db` | `tag_compare` is always `repository_evidence`; `advisory` is always `advisory_db` |

**Text normalization**: before hashing, snapshotting or excerpt checks, source text is normalized once: line endings to `\n`, Unicode NFC, trailing whitespace stripped per line. Excerpts must be exact substrings of the normalized text, and the normalized text is what the snapshot keeps. For matching only, inline markdown (backticks, `*`, `_`, a leading list marker) is ignored on both sides. The stored `excerpt` is then replaced by the original source span it matched.

## ChangeItem

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | `c1`, `c2`, … within one answer |
| `kind` | `breaking` \| `deprecation` \| `security_fix` | |
| `version` | semver string | The release it belongs to |
| `evidenceType` | `documented` \| `repository_evidence` \| `inferred` | FR-010 |
| `change` | string | What changed |
| `excerpt` | string \| null | Required unless `inferred`; exact substring of the normalized source text |
| `inferredFrom` | string[] | Required when `inferred`: ids of the `ChangeItem`s it is based on |
| `migration` | string \| null | What to do; null when `migrationEvidence = manual_review` |
| `migrationEvidence` | `documented` \| `inferred` \| `manual_review` | FR-010a |
| `migrationExcerpt` | string \| null | Required when `migrationEvidence = documented`; exact substring of a source |
| `migrationSourceId` | string \| null | Source of `migrationExcerpt`; may differ from `sourceId` (e.g. a migration guide) |
| `migrationInferredFrom` | string[] | Required when `migrationEvidence = inferred`: ids of the ChangeItems (`c…`) or sources (`s…`) the step relies on. Empty otherwise. A step that cannot name any is `manual_review` |
| `ids` | string[] | CVE/GHSA ids found in the excerpt |
| `sourceId` | string | References a `ReleaseSource` |

## Advisory

Keeps enough of the OSV record to decide, for any version, whether it is affected.

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | OSV id |
| `aliases` | string[] | CVE/GHSA ids, from OSV |
| `severity` | `{type, score}[]` | OSV severity entries, kept as-is |
| `displaySeverity` | `critical` \| `high` \| `moderate` \| `low` \| `unknown` | Derived for display only, from `database_specific.severity` or a CVSS score |
| `affectedVersions` | string[] | OSV `affected[].versions`, for the npm package only |
| `ranges` | `{type, events: {introduced?, fixed?, lastAffected?, limit?}[]}[]` | OSV `affected[].ranges`, for the npm package only; all ranges kept |
| `fromAffected` | `yes` \| `no` \| `unknown` | Whether A is affected, by the check below |
| `targetAffected` | `yes` \| `no` \| `unknown` | Whether B is affected, by the check below |
| `conclusion` | `fixed_by_upgrade` \| `still_affected` \| `introduced_by_upgrade` \| `not_applicable` \| `unknown` | One per advisory, from the spec's User Story 4 table. `not_applicable` when neither A nor B is affected |
| `releaseNoteItemId` | string \| null | Id of the correlated `security_fix` ChangeItem, if any |
| `sourceId` | string | The `advisory` source |

**Affected check** for a version V, per OSV schema:
1. V is affected if it is listed in `affectedVersions`.
2. Otherwise, for each `SEMVER` or `ECOSYSTEM` range, sort its events by version, with `introduced: "0"` as the lowest possible version (it is not valid semver and is never passed to `semver`). Walk them: `introduced` starts an affected interval, `fixed` ends it (exclusive), `last_affected` ends it (inclusive). A `limit` caps the whole range: versions at or above it are not affected by this range.
3. V is affected if any range puts it in an affected interval.

Ranges of other types are ignored, and make the result `unknown` if they are the only data. Comparing V with a single "first fixed" version is not allowed. Advisories for A and for B are both queried, so an advisory that only B is affected by is found.

Correlation then follows the spec's User Story 4 table; with no evidence, no claim is made. Security fixes documented in release notes without a matching advisory stay `security_fix` ChangeItems.

## Security

| Field | Type | Rule |
| --- | --- | --- |
| `status` | `complete` \| `partial` \| `unavailable` \| `not_checked` | `partial` when the OSV response was truncated or a referenced record could not be read. `not_checked` when no package was resolved (`out_of_scope`, `needs_clarification`) |
| `checkedAt` | ISO timestamp \| null | When OSV was queried (both queries, A and B) |
| `advisories` | Advisory[] | Empty means "none known" only when `status = complete` |
| `documentedFixes` | number | Count of `security_fix` ChangeItems |

## Coverage

| Field | Type |
| --- | --- |
| `complete` | boolean |
| `covered` | semver string[] |
| `notCovered` | `{version, reason}[]`; reason is one of `no_material`, `unmatched`, `budget`, `upstream_unavailable`, `truncated` |

## Answer

| Field | Type | Rule |
| --- | --- | --- |
| `answer` | string | Full plain-text rendering, readable on its own (FR-013, R1) |
| `summary` | string | One or two sentences |
| `outcome` | `found` \| `not_found` \| `needs_clarification` \| `out_of_scope` \| `temporarily_unavailable` | Exactly one (FR-014). `temporarily_unavailable` is a delivery failure and is not charged (FR-025) |
| `confidence` | number 0–1 | Deterministic, see below. Never a model's self-reported confidence |
| `request` | NormalizedRequest \| null | Null when the question names no resolvable package (`out_of_scope`, some `needs_clarification`) |
| `targetReleasedAt` | ISO timestamp \| null | From the registry |
| `changes` | ChangeItem[] | |
| `security` | Security | FR-016 |
| `coverage` | Coverage \| null | Required when `outcome = found` (FR-015) |
| `sources` | ReleaseSource[] | Everything consulted, used or not |
| `clarification` | string \| null | What is missing, for `needs_clarification` |
| `processingVersion` | string | Prompt version, LLM miner id, extractor mode and schema version (FR-018) |

**Confidence** is the confidence in the outcome label, computed from fixed bands so the same inputs always give the same number:

| Situation | Confidence |
| --- | --- |
| `found`, complete coverage, every item `documented` | 0.9 |
| `found`, complete coverage, some `repository_evidence` or `inferred` items | 0.7 |
| `found`, partial coverage | 0.5 |
| `found`, complete coverage, no items (no breaking changes or deprecations documented) | 0.9 |
| `not_found`, every listed source responded | 0.8 |
| `not_found`, an optional source (e.g. the changelog) failed | 0.6 |
| `needs_clarification`, `out_of_scope` | 0.9 |
| `temporarily_unavailable` | 0 |

For `found` and `not_found` only, subtract 0.1 when `security.status` is not `complete`. It is a label confidence, not a claim that the migration is correct.

## State: answer lifecycle

```text
query → auth check ──(missing or wrong key)──> 401, no work
      → parse → resolve ──(ambiguous)──> needs_clarification
                   │──(not a package)──> out_of_scope
                   │──(version missing)─> not_found
                   ▼
     retrieval: registry → releases pages → changelog → compare (fallback order decided by matching,
     before any extraction), plus OSV queries for A and B. Each document goes through the manifest:
     fresh entry → snapshot reused; stale → conditional GET (304 → snapshot reused); missing → fetched
                   │──(required source down)──> temporarily_unavailable (not cached, not charged)
                   ▼
     consulted set and its content hashes known → answer-cache lookup ──hit──> cached Answer (byte-identical)
                   ▼ miss (one computation per key; concurrent identical requests wait briefly for it)
     derive version sections from snapshots → extract + verify → correlate → coverage → outcome
                   ▼
     found / not_found → answer stored (only if security.status = complete) → render
```

The answer-cache key is `sha256(answer identity + sorted contentHashes of every source consulted, OSV responses included + PROCESSING_VERSION)`. "Consulted" is fixed by the retrieval step, before extraction, so the same key is computed at lookup and at store. A new advisory changes the OSV response hash and so the key. An answer whose security check was partial or unavailable is not cached, so it is retried.

## Metrics record (one per request, FR-027)

`requestHash, authOk, cacheHit, outcome, declaredFailure (true for outcomes outside errors.success_values), extractorMode (rules_only | rules_and_model), msResolve, msFetch, msModel, msTotal, upstreamRequests, conditionalHits, llmMinerId, modelCalls, modelInputChars, modelCostUsdc, llmFailure (null | timeout | invalid_reply | payment), budgetExhausted`

Payment fields, filled from Telegraph receipts and settlement data when available, not from the request: `quotedAmountUsdc, settledAmountUsdc, protocolFeeUsdc, providerAccrualUsdc, charged`. `charged` comes only from Telegraph's receipt or settlement data, never from the miner, so it can be compared with `declaredFailure`. The final payout is recorded per settlement batch in `miner/bench/network.md`, since one batch may cover many calls.
