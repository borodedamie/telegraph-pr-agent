# Contract: `GET /api/answer`

The single endpoint Telegraph calls. Telegraph exposes it to buyers as `/answer` and forwards to `external_path: /api/answer`, because Vercel serves functions in `api/` under `/api/` ([telegraph-miner.yaml](telegraph-miner.yaml)).

## Request

```
GET /api/answer?query=<url-encoded free-form question>
X-Telegraph-Key: <key installed on the node after registration>
```

| Input | Required | Notes |
| --- | --- | --- |
| `X-Telegraph-Key` header | yes | Compared with `MINER_API_KEY` in constant time. Missing or wrong → `401`, before any work |
| `query` | yes | Plain-text question. Max 2,000 chars; longer → `400` |

Example:

```
GET /api/answer?query=What%20changed%20in%20the%20npm%20package%20zod%20from%203.23.8%20to%204.0.0%3F
```

The PR bot always names both versions. Other agents may name only the target; see spec FR-004.

## Response

Authenticated, well-formed queries always get `200` with a JSON `Answer` (see [data-model.md](../data-model.md)). Billing is decided by `outcome`, via the YAML's `errors.status_path`:

| `outcome` | Billed |
| --- | --- |
| `found`, `not_found`, `needs_clarification`, `out_of_scope` | Yes: valid answers (FR-025) |
| `temporarily_unavailable` | No: declared a failure through `errors.success_values` |

A `200` also carries three headers for the benchmark (SC-006, SC-011). They are not part of the answer and never carry secrets:

| Header | Value |
| --- | --- |
| `x-miner-cache` | `hit` when the answer came from the cache, else `miss` |
| `x-miner-model-calls` | LLM miner calls made for this request (0 on a hit) |
| `x-miner-model-cost-usdc` | What those calls cost, in USDC |

Non-200 codes:

| Status | When |
| --- | --- |
| `400` | Missing or oversized `query` |
| `401` | Missing or wrong `X-Telegraph-Key` |
| `429` | Origin rate limit or concurrent first-time limit exceeded |
| `500` | Bug; logged with request hash |
| `503` | The miner itself is misconfigured (e.g. `MINER_API_KEY` unset in production), not an upstream outage |

Example, **illustrative only**: the items, version lists and ids below are not verified against the real zod sources and must not be used as expected output. The shape is normative: every `sourceId` references a listed source. The benchmark's reviewed expectations are the ground truth.

```json
{
  "answer": "zod 3.23.8 → 4.0.0 (released 2025-07-09): 3 breaking changes, 1 deprecation. Security: OSV checked, no known advisories for 3.23.8. Coverage complete.\n\nBreaking:\n1. String formats moved to top level (4.0.0). Migrate (documented): z.string().email() → z.email(). Evidence: \"...\" [s2]\n...\n\nSources: [s1] https://registry.npmjs.org/zod [s2] https://github.com/colinhacks/zod/releases/tag/v4.0.0",
  "summary": "Upgrading zod 3.23.8 → 4.0.0 has 3 documented breaking changes and 1 deprecation.",
  "outcome": "found",
  "confidence": 0.9,
  "request": { "ecosystem": "npm", "package": "zod", "fromRequested": "3.23.8", "toRequested": "4.0.0", "fromResolved": "3.23.8", "toResolved": "4.0.0", "fromAssumed": false },
  "targetReleasedAt": "2025-07-09T18:47:37.886Z",
  "changes": [
    { "id": "c1", "kind": "breaking", "version": "4.0.0", "evidenceType": "documented", "change": "String format methods moved to top level", "excerpt": "...", "inferredFrom": [], "migration": "Replace z.string().email() with z.email()", "migrationEvidence": "documented", "migrationExcerpt": "...", "migrationSourceId": "s2", "migrationInferredFrom": [], "ids": [], "sourceId": "s2" }
  ],
  "security": { "status": "complete", "checkedAt": "...", "advisories": [], "documentedFixes": 0 },
  "coverage": { "complete": true, "covered": ["3.24.0", "3.24.1", "3.25.0", "4.0.0"], "notCovered": [] },
  "sources": [
    { "id": "s1", "type": "registry", "url": "https://registry.npmjs.org/zod", "retrievedAt": "...", "versionFrom": null, "versionTo": "4.0.0", "contentHash": "...", "snapshotKey": "snap:...", "trust": "official" },
    { "id": "s2", "type": "release", "url": "https://github.com/colinhacks/zod/releases/tag/v4.0.0", "retrievedAt": "...", "versionFrom": "3.25.76", "versionTo": "4.0.0", "contentHash": "...", "snapshotKey": "snap:...", "trust": "official" },
    { "id": "s3", "type": "advisory", "url": "https://api.osv.dev/v1/query", "retrievedAt": "...", "versionFrom": null, "versionTo": null, "contentHash": "...", "snapshotKey": "snap:...", "trust": "advisory_db" }
  ],
  "clarification": null,
  "processingVersion": "p1-llm901-rules_and_model-s1"
}
```

`answer` is the only field a generic buyer needs. Everything else is for agents that parse JSON, such as the PR bot.

## `GET /api/health`

Public, no key. Returns `200 {"ok": true, "processingVersion": "...", "probedAt": "...", "upstreams": {"npm": "ok", "github": "ok", "osv": "ok", "redis": "ok"}}`.
- Probe results are cached in Redis for 5 minutes. When they are older, the call refreshes them with one cheap request per upstream: the registry `/-/ping`, GitHub `/rate_limit`, an OSV query for a fixed package, and a Redis `PING`. So unauthenticated callers can trigger at most one probe per 5 minutes.
- It never calls a model.
- `ok` is `false`, with `503`, when Redis or the registry is down.
