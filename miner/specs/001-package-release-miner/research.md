# Research: Package-release miner

Phase 0 of [plan.md](plan.md). Each item: decision, rationale, alternatives. Facts marked "live" were read from the network or vendor docs on 2–3 Nov 2026 and must be rechecked before use.

## R1. Telegraph request and response contract

There are two contracts, and they are kept apart:

- **Intent input**: what a buyer sends for `QUESTION_ANSWERING_GENERAL`. Live on 2 Nov the intent had no request or response schema; the Engine rejects `params` for it and expects a free-form `query`.
- **Endpoint mapping**: how the node turns that into an HTTP call to us, declared per endpoint in our YAML (`path`, `external_path`, `method`, `params.query`).

- **Decision**: One endpoint. Telegraph-facing `path: /answer`, upstream `external_path: /api/answer` (Vercel serves functions in `api/` under `/api/`), `GET`, one required query param `query`. The response is a JSON object whose `answer` field is the full plain-text rendering, with the structured result alongside. `signal_mapping` points at `outcome` (label), `summary` (reason) and `confidence`.
- **Rationale**:
  - Live YAML reference (3 Nov): `external_path` is required on every endpoint and is separate from `path`; the schema rejects unknown keys.
  - On 3 Nov a direct paid call to LiveCert reached it as `{method, endpoint, payload: {query}}`, and the Engine returned the miner's own JSON unchanged with `result_shape: "raw"`. This is preliminary evidence that the Engine passes our JSON through and the buyer reads `answer`.
  - `signal_mapping` allows only `confidence_field`, `label_field` and `reason_field`.
- **Known before registration**: the intent's live definition, the YAML validation result and the request the dashboard sandbox sends to our upstream.
  - On 3 Nov the definition was unchanged: no request or response schema, and no declared timeout. So the 20 s budget stays until the first paid routed call (T063) measures the Engine's real limit.
  - The public validation API answered `405`, so validation runs in the dashboard.
- **Known only after registration**: the request the Engine sends when it routes a real purchase to us, and whether it wraps or normalizes the result. These are captured in the first paid test (plan phase 10), and the rendering is adjusted if needed (FR-017).
- **Alternatives**: one endpoint per question kind was rejected, because buyers send one free-form query. Returning plain text only was rejected, because the PR bot needs the structured items.

## R2. Hosting

- **Decision**: Vercel Functions, Node.js runtime, Fluid compute, `maxDuration: 30` (our own cap, below the plan limit). Single region, `iad1` by default; the Engine-to-miner round trip is measured before the region is final.
- **Rationale**: Live limits are a 300 s maximum duration on Hobby with Fluid compute, 2 GB memory and a 4.5 MB response body. Deploying from GitHub is free, and it's the same TypeScript stack as `bot/`.
- **Open**: Vercel Hobby is for personal, non-commercial use. A testnet hackathon entry is probably fine, but a provider that takes payments may not be. Confirm before production registration, or budget for Pro.
- **Alternatives**: Cloudflare Workers + KV is the fallback if cold starts break the latency target; its runtime isn't full Node, so it costs more porting. Fly.io, Railway and Render are always-on but have weaker free tiers. A self-run VPS means we own the uptime.

## R3. Cache, snapshots and reproducibility

- **Decision**: Upstash Redis via the Vercel Marketplace (Vercel's KV product is now provided this way). Three stores:
  1. **Source manifest**, keyed by processing version and request URL (for OSV, by the query body; a snapshot holds reduced text, so a reducer change must not reuse an old-shape snapshot on a `304`): `{etag, lastModified, fetchedAt, contentHash, snapshotKey}`.
     - An entry younger than the freshness window (default 1 h) is reused without a request.
     - An older one is revalidated with a conditional GET (`If-None-Match` / `If-Modified-Since`), and a `304` keeps the hash and the snapshot. GitHub does not count `304` responses against the rate limit. OSV has no conditional requests, so a stale OSV entry is simply re-queried.
  2. **Snapshots**, content-addressed (`snap:<contentHash>`): the whole normalized document as fetched (a releases page, a `CHANGELOG.md`, a compare response, an OSV response). For the registry, only the fields used (`versions` keys, `time`, `dist-tags`, `repository`), because the full document can be tens of MB. Version sections are derived from the snapshot on every use, so a manifest hit or a `304` always has the text for any version. No TTL during the hackathon evaluation period (FR-019).
  3. **Answer cache**, keyed by `sha256(answer identity + sorted contentHashes of every source consulted + PROCESSING_VERSION)`, returned byte for byte on a hit (FR-018). Answer identity is the whole `NormalizedRequest` ([data-model](data-model.md)). The OSV responses are consulted sources, so a new advisory changes the key. A `found` or `not_found` answer whose `security.status` is not `complete` is not stored. `out_of_scope` and `needs_clarification` answers never reach OSV (`security.status: not_checked`) and are stored when they have a `NormalizedRequest` to key on; without one (`request: null`) they skip the cache.
- **Order**: resolve → retrieval through the manifest (which documents to consult is decided by version matching, before extraction) → hashes → answer-cache lookup → derive sections and extract only on a miss. The key is computed from the same consulted set at lookup and at store.
- **Concurrency**: on a miss, a `SET NX` lock on the answer key makes one instance compute.
  - The lock TTL is the time budget plus 5 s, and the computation has a hard deadline: in-flight fetches and model calls are aborted (`AbortController`) at the budget, so the lock never expires while work is still running.
  - Other identical requests poll the answer cache for at most 5 s (`LOCK_WAIT_MS`). If no answer appears, they compute themselves only if a full time budget still fits before `maxDuration`, and otherwise return `temporarily_unavailable` (not charged).
  - With the 20 s budget, 5 s wait and `maxDuration: 30`, the worst case is 25 s.
- **Rationale**: identical sources plus an identical processing version give an identical answer, even though the model is non-deterministic. `PROCESSING_VERSION` combines the prompt version, model id and output schema version, so bumping any of them invalidates old answers.
- **Storage size**: snapshots are content-addressed, so one changelog or releases page is stored once however many answers use it. The registry is reduced to the fields used. Checked during the benchmark against the Upstash free tier.
- **Alternatives**:
  - An in-memory cache only was rejected, because serverless instances are ephemeral.
  - A database was rejected as heavier than needed.
  - Hash-only retention was rejected: it proves identity but cannot reproduce text.

## R4. Package and version resolution

- **Decision**: npm registry `GET https://registry.npmjs.org/<name>` (scoped names URL-encoded) gives `versions`, `time`, `dist-tags` and `repository`. Ranges are resolved with the `semver` library against the published versions. When only a target is given, the "from" default follows FR-004: the highest stable version below `B.major.0.0` for major ≥ 1, below `0.y.0` for `0.y.z` with y ≥ 1, and none for `0.0.z`.
- **Size**: the full document (the only one with `time`) is tens of MB for heavily published packages such as `typescript`, `next` or `@types/node`. The registry gets its own size cap (64 MB, streamed and parsed once). Only the fields used are kept and snapshotted.
- **Rationale**: this is deterministic, free and authoritative, and the PR bot already uses the same source.
- **Alternatives**: the npm search API was rejected, because its results are fuzzy and could cause package substitution (FR-003).

## R5. Release sources and version correspondence

- **Decision**: Resolve the repository from the registry's `repository` field: GitHub only, with `directory` noted for monorepos. Then try, in order:
  1. **GitHub Releases** via `GET /repos/{o}/{r}/releases`, paged. A release is matched to the package version by tag pattern (`v1.2.3`, `1.2.3`, `<pkg>@1.2.3`, `<pkg>-v1.2.3`, `<pkg>/v1.2.3`). In monorepos it is also used only if the release body or tag names the package.
  2. **`CHANGELOG.md`** in the package directory, falling back to the repo root, via `raw.githubusercontent.com`, split into sections by version headings.
  3. **Migration guide** (added 3 Nov, after zod 4.0.0 turned out to have no GitHub release and no `CHANGELOG.md`): for the first release of a new major line (or 0.y line), one `GET /repos/{o}/{r}/git/trees/HEAD?recursive=1`, then the shortest Markdown/MDX file whose name says migration, upgrade, changelog or breaking and whose path names the new line (`v4`, `4.0`, `version-4`), preferring paths that name the package (`react` for `@tanstack/react-query`). It is fetched from `raw.githubusercontent.com` and each of its change headings becomes a documented item. A tree above the 2 MB cap skips this step.
  4. **Tag comparison** via `GET /repos/{o}/{r}/compare/{base}...{head}` as a last resort, with the exact tags found by step 1's patterns.
     - Evidence comes from the changed code: `files[].patch` for files under the package `directory`, prioritizing type declarations (`*.d.ts`), entry points and `package.json` (`exports`, `main`, `engines`, `peerDependencies`). Commit messages and file names alone are never evidence.
     - GitHub returns at most 300 files and 250 commits per comparison, and omits large patches. Hitting any of these limits makes coverage `partial`, with reason `truncated`.
     - Items from this step are `repository_evidence`.
- **Rationale**: this covers the common release styles and keeps a source from being misattributed (FR-007). A GitHub token is needed: without one, the REST limit is 60 requests per hour.
- **Alternatives**: scraping the npm website was rejected. Using `npm view` or diffing published tarballs was rejected, because the miner must never install or download package archives.

## R6. Advisories

- **Decision**: two queries, `POST https://api.osv.dev/v1/query` with `{package: {name, ecosystem: "npm"}, version: A}` and the same with `version: B`. Their union is the advisory list. Querying B as well finds advisories that the upgrade introduces. For each one, the miner keeps:
  - the full npm `affected` data: every range with all its events (`introduced`, `fixed`, `last_affected`, `limit`) and the explicit `versions` list;
  - the OSV severity entries as they are.

  Whether A and B are affected is evaluated against all of it, with events sorted and `introduced: "0"` handled as the lowest version ([data-model](data-model.md), Advisory). CVE/GHSA ids found in release-note evidence are cross-linked via `aliases`.
- **Status**:
  - `complete` when both queries succeeded and every record was read;
  - `partial` when the response paged (`next_page_token`) beyond the budget or a record was unreadable;
  - `unavailable` when OSV could not be reached.

  An OSV failure never fails the migration answer.
- **Implementation (4 Nov 2026)**: `src/sources/osv.ts`, `src/affected.ts`, `src/correlate.ts`.
  - Both queries run after resolve and before the GitHub retrieval, and count against `MAX_SOURCE_REQUESTS` (two requests, more if a query pages).
  - A query reads at most 3 pages; a longer list makes the check `partial`. One of the two queries failing makes it `partial`; both failing makes it `unavailable`, with `checkedAt: null`.
  - Of each record, only the `affected` entries for the npm package with exactly the asked name are kept (one record often lists `lodash-es`, `lodash.template` or a RubyGems package too), with its `summary`, `aliases`, `severity`, `database_specific.severity` and `modified`. A new or edited advisory changes the response hash and so the answer key.
  - Each page read is an `advisory` source. The conclusion follows the record's ranges, whichever query returned it.
  - A `security_fix` item is linked to an advisory only when its excerpt names the advisory id or an alias.
- **Rationale**: OSV is free, needs no key and is authoritative for affected ranges. A single "first fixed" version is wrong for advisories with several ranges.
- **Alternatives**: the GitHub Advisory Database API was rejected, because OSV already aggregates it and it needs a token.

## R7. Change extraction and the language model

- **Decision**: Use a two-step extractor behind a `ChangeExtractor` interface.
  1. **Deterministic pass**: find sections headed Breaking, Removed, Deprecated, Migration or Security, and CVE/GHSA patterns. Since 4 Nov it also reads common breaking-change phrases ("no longer", "has been removed", "drop support for", "requires Node", "renamed", "use X instead" …) in bullets and prose sentences of line-start releases (x.0.0, 0.y.0), outside Fixes headings and maintenance lines. The phrases were chosen from 284 major-release notes of 89 packages: [miner/bench/phrase-rules.md](../../bench/phrase-rules.md). A line-start release is never "handled" by its headings alone, so its unmarked prose stays open for the model. A line-start release with no item whose notes only link to a guide is reported as "not assessed", and the answer's confidence is capped at 0.5.
  2. **Model pass**: classify and extract items from version-specific text, returning JSON validated with zod. The model may also return `inferred` items and steps, each with the ids of the items or sections it relies on.

  **Where the model comes from**: it is bought on Telegraph itself, paid in test USDC, so the hackathon costs no real money and the miner is itself a buyer on the network.
  - An ordered list of LLM miners comes from `LLM_MINERS`, as `<minerId>:<method>:<path>`. Each one is called directly via `POST /engine/v1/ask/<minerId>`, paid with the `escrow` scheme from the spend wallet's prefunded Telegraph escrow balance (R11). The miner signs the 402 `extra.message` template with EIP-191 `personal_sign` and sends it as `X-PAYMENT`, only after checking that the template names the Telegraph Diamond as payee, Sepolia and the quoted amount.
  - Paid tests on 3 Nov, one release-note section each ([snapshot](../../../docs/telegraph/miner-yaml-and-ranking-2026-11-03.md)):

    | Miner | Result | Miner time / total |
    | --- | --- | --- |
    | `302` `chainsight-oracle`, `POST /gen` `{query}` | Complete JSON, all items found; excerpts verbatim except that inline backticks were dropped | 2 s / 20 s |
    | `7413` `aiwire-language-generation`, `GET ?prompt=` (MiniMax-M2.5) | Exact verbatim excerpts, but the reply is cut at ~876 characters, so the JSON was incomplete | 8 s / 27 s |
    | `901` `groq-llama31-instant-miner`, `POST /chat` | `200` with "AuthenticationError" inside, charged | 33 s / 43 s |

  - Default order: `LLM_MINERS=302:POST:/gen,7413:GET:/language-generation`. With 7413, prompts ask for the compact line format `kind|excerpt|migration`, so one reply fits its length limit.
  - **Payment scheme, measured 5 Nov** ([network log](../../bench/network.md)): 10 calls each to `302` with the same 6,000-character prompt.

    | Scheme | Median total | Range | Miner's own `duration_ms` |
    | --- | --- | --- | --- |
    | x402 `exact` | 13.3 s | 8.1–20.8 s | 1.2–2.1 s |
    | `escrow` | 2.0 s | 1.7–4.1 s | 1.2–2.3 s |

    With `exact`, each call waits for its own settlement transaction: the 10 transfers were mined one per block. `escrow` settles at epoch close, with no per-request transaction. So the miner pays with `escrow`. An escrow refusal (`402`, for example "insufficient escrow for delivery") is not billed and falls back to the deterministic pass.
  - The chosen miner id is part of `PROCESSING_VERSION`.
  - **A `200` is not trusted.** A miner that answers `200` with an error inside counts as delivered and is charged. So a reply only counts if it parses into the zod item schema. Otherwise the call is a failure, and that miner is skipped for 15 minutes (a circuit breaker in Redis).
  - **One model call per first-time answer** (`MAX_MODEL_CALLS = 1`): one call costs 0.01, the same as our price.
  - **Timeout**: `LLM_TIMEOUT_MS` defaults to 12 s.
  - **Fallback**: when the call fails, times out or no miner is available, the answer is built by the deterministic pass only. It says that prose changes may be missing and is not cached, so it is retried next time.

  The extractor mode (`rules_only` or `rules_and_model`) is part of `PROCESSING_VERSION`, so a rules-only answer never shares a cache key with a full one.

  For a multi-release request, the version-specific sections are batched into as few calls as the token budget allows. Each section is labelled with an opaque section id, never a version. Releases fully handled by the deterministic pass are not sent to the model.
- **Verification**:
  - Every `excerpt` and every `migrationExcerpt` must be an exact substring of the normalized source text, or it is dropped.
  - Matching is markup-insensitive: inline markdown (backticks, `*`, `_`, a leading list marker) is ignored on both sides. The excerpt shown is the original source span, never the model's copy. Words still have to match exactly. This handles models that drop backticks, as `302` did.
  - A migration step without its own verified excerpt is downgraded: to `inferred` if `migrationInferredFrom` names existing items or sources, otherwise to `manual_review` (FR-010a).
  - The model never sees or produces versions, dates or links; code attaches them via the section id.
- **Rationale**: the model is used only where judgment helps, and the verbatim checks enforce the governing principle mechanically, for changes and for migration steps.
- **Alternatives**: rules alone were rejected, because they miss changes written as prose. Model-only extraction was rejected, because it can hallucinate.

## R8. Safe fetching

- **Decision**: A single `safeFetch`:
  - **Hosts and paths**:
    - `registry.npmjs.org`;
    - `api.github.com` and `github.com`, on repository paths;
    - `raw.githubusercontent.com`, on validated repository paths;
    - `api.osv.dev`, `POST /v1/query` only.

    `https` only, default port only.
  - **Addresses**: DNS is resolved, and every address is checked against private, loopback, link-local, CGNAT and metadata ranges. The connection then goes to the validated address. Requests use `node:https` with a `lookup` that returns that address, so a second resolution cannot rebind. Node's `fetch` cannot pin the address without an extra dependency.
  - **Redirects**: followed manually, at most 3, with every hop rechecked.
  - **Limits**: per-response size limit and timeout.
- **Rationale**: FR-020, FR-021 and FR-022.
- **Alternatives**: a library-level SSRF agent was rejected; it's an extra dependency for a small, testable function.

## R9. Budgets (defaults, tuned after measurement)

| Budget | Default |
| --- | --- |
| Per-response size | 2 MB; registry 64 MB (R4) |
| Waiting on another instance's computation (`LOCK_WAIT_MS`) | 5 s |
| Source requests per answer | 25 |
| Overall time per answer | 20 s |
| Redirects | 3 |
| Comparison | first 250 commits, 300 files |
| Intermediate releases processed | 50 |
| Model calls per request (`MAX_MODEL_CALLS`) | 1 |
| Model input per call (`MAX_MODEL_INPUT_CHARS`) | 24k characters; tuned to what the chosen LLM miner accepts |
| Model cost per request (`MAX_MODEL_COST_USDC`) | 0.01 test USDC, from the escrow quote; a higher quote is refused |
| Model call timeout (`LLM_TIMEOUT_MS`) | 12 s |
| Releases sent to the model (`MAX_MODEL_RELEASES`) | 20 |

When a budget stops work, the answer's coverage is partial and the cut releases are named with reason `budget`.

**Latency**:
- The 20 s budget and `maxDuration: 30` are engineering limits, not proof that Telegraph accepts that latency.
- The Engine's timeout for this intent is read during contract capture and recorded, and the time budget is lowered to fit it.
- Cold first-time answers are expected to be slow. Pre-warming the benchmark packages keeps the demo on the cached path.

## R10. Origin authentication and abuse limits

- **Decision**:
  - The YAML declares `auth: {type: header, header_name: X-Telegraph-Key}`.
  - After registration, the key is installed against our slug on the node, signed with the registering wallet. Live docs: keys never go in the public YAML, and installing one before registration returns `404`.
  - The endpoint compares the header with `MINER_API_KEY` in constant time and returns `401` before doing any work.
  - In production, a missing `MINER_API_KEY` returns `503` (fail closed).
- **Abuse limits**:
  - The YAML declares a `limitations` rate entry, which the node checks before charging buyers, and `rate_limit_per_sec`, a cap the node applies to its own calls to us.
  - The origin also keeps its own per-minute counter and a cap on concurrent first-time computations in Redis, returning `429` above either. Each compute slot is its own Redis key with the lock TTL, so a slot left by a killed function frees itself. Defaults: `ORIGIN_RATE_PER_MIN=120`, `MAX_CONCURRENT_COMPUTE=4`.
- **Rationale**: Telegraph's payment gate protects calls through the Engine, not our Vercel URL. Without origin auth, anyone could use the miner for free while the team pays for GitHub, OSV, model and Redis usage.
- **Gap**: between registration and key installation, the node calls us without the key, so those calls get `401`. Install the key immediately after registration, before announcing the miner.

## R11. Failures, billing and payout

- **Decision**: The YAML declares `errors: {message_path: summary, status_path: outcome, success_values: [found, not_found, needs_clarification, out_of_scope]}`.
  - Live docs: with `status_path` set, a `200` whose status is not a success value is treated as a failure. The caller is not charged and no signal is recorded.
  - So `temporarily_unavailable` stays a `200` with a full body for logs, but is not billed.
- **Payout wallet**: a new wallet for the miner, separate from the bot's `0x46D0…C77b`. Validate and register at anjoman.ai/dashboard/earn, which pins the YAML. Registration is on chain and can't be edited. Its key never goes on the server.
- **Spend wallet**: a second new wallet whose key is set as `MINER_SPEND_KEY` in Vercel. It pays for LLM calls from its Telegraph escrow balance, funded with `depositUSDC` or `depositUSDCFor` on the Diamond (`0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b`). The caller signs only escrow authorizations to that Diamond, at most `MAX_MODEL_COST_USDC` each and valid for 100 s. Leaking the key can lose at most the escrow balance and the wallet's test USDC. When the escrow runs dry, model calls are refused unbilled and answers fall back to rules only, so the balance needs topping up.
- **Payout accounting**: the buyer's price is not the miner's income.
  - Per call, the miner records the quoted and settled price and whether it was charged.
  - The protocol share, the provider accrual and the payout currency are read from receipts and settlement data.
  - The external review describes a 2% protocol fee, 98% to the provider and conversion to MACHINA at epoch settlement. This is not yet confirmed against the live docs and is checked before it is reported.
- **YAML facts (live, 3 Nov)**:
  - `id` is a numeric miner id that must be unused (check `GET /api/miners`).
  - `on_chain.transform` is required when the `on_chain` block exists.
  - `on_chain.min_price_usdc` is a decimal USDC amount (`0.01`), not base units.

## R12. Ranking data

Live on 3 Nov ([snapshot](../../../docs/telegraph/miner-yaml-and-ranking-2026-11-03.md)):

| Endpoint | What it shows |
| --- | --- |
| `GET /api/miners?intent=<id>` | Catalogue entries with `scores[]` (`intent_id`, `epoch_id`, `rank`, `score`), `activation_status`, `scored`, `last_scored_epoch` |
| `GET /engine/v1/intents/<id>/miners` | The providers competing for the intent, with `cost_per_call` and `capabilities`; no `rank` or `score` fields |
| `GET /leaderboard/miners` | Per-intent ranking for the current epoch (`miner_slug`, `score`, `rank`, `activation_status`); no `QUESTION_ANSWERING_GENERAL` entry in epoch 2002 |

The ranking check reads all three and records each response's shape as observed.
