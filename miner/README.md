# Package Release Intelligence (Telegraph miner)

Answers one kind of question: what changed in an npm package between two versions. Each breaking change, deprecation and security fix comes with a verbatim quote and a link to the release material it came from, plus the package's known advisories (OSV) and whether the upgrade fixes them. When nothing can be found, it says so instead of guessing.

The full spec is [specs/001-package-release-miner/spec.md](specs/001-package-release-miner/spec.md); the plan, data model and tasks sit next to it.

## Status (9 Nov 2026)

| | |
| --- | --- |
| Endpoint | `https://telegraph-pr-miner-n30sk.vercel.app` (Vercel production) |
| Telegraph | miner id 7314, slug `package-release-intel`, intent `QUESTION_ANSWERING_GENERAL`, `active`, floor price 0.02 USDC |
| Score | rank 6 of 17, score 0.9732 (epoch 2046; was rank 11, 0.7955, at epoch 2042 before our pool questions and the `p8` answer layout). Rank 6 was measured with our own 30 questions in the pool (1 of 6 contributors), so it is not independent evidence of quality; the benchmark is the quality evidence. The intent's judge is general, see [docs/telegraph/qa-scoring-2026-11-09.md](../docs/telegraph/qa-scoring-2026-11-09.md) |
| Benchmark | 67.1% of reviewed breaking changes found by word matching, 82.6% with matches counted by an LLM judge (target 80%); every quote checked against its source ([bench/report.md](bench/report.md), [bench/judge-report.md](bench/judge-report.md)) |

Every step, with transactions and dates, is in [bench/network.md](bench/network.md).

## Asking it

Through Telegraph, ask this miner directly by id:

```bash
# paid: x402 challenge, then payment (see the bot's IntelligenceClient in bot/src/x402.ts)
POST https://devnode.telegraphprotocol.com/engine/v1/ask/7314
{ "method": "GET", "endpoint": "/answer", "payload": { "query": "What changed in express from 4.21.0 to 5.0.0?" } }
```

Engine routing (`POST /engine/v1/ask` without an id) classified package questions as `WEB_SEARCH_GENERAL` on 6 Nov and sent them to another miner, so ask by id.

The origin itself only answers Telegraph: `GET /api/answer?query=…` needs the `X-Telegraph-Key` header, which is installed on the node against the slug. A missing or wrong key gets `401` and does no work. Locally, with the key from `miner/.env`:

```bash
KEY=$(grep '^MINER_API_KEY=' miner/.env | cut -d= -f2-)
curl -H "X-Telegraph-Key: $KEY" "http://localhost:3000/api/answer?query=What%20changed%20in%20zod%20from%203.23.8%20to%204.0.0%3F"
curl http://localhost:3000/api/health
```

Setup, tests and the benchmark: [specs/001-package-release-miner/quickstart.md](specs/001-package-release-miner/quickstart.md).

## A good question

Name the package, then the installed version, then the target, oldest first: "What changed in zod from 3.23.8 to 4.0.0?" or "Our app runs express 4.21.0; what breaks in 5.0.0?". The parser reads the word right before the first version as the package name, and more than two versions get `needs_clarification`.

## Outcomes and billing

| `outcome` | Meaning | Billed |
| --- | --- | --- |
| `found` | changes listed with quotes and sources; `coverage` says which releases were read | yes |
| `not_found` | no usable release material, or the version does not exist (the closest published ones are named) | yes |
| `needs_clarification` | the package or versions are unclear | yes |
| `out_of_scope` | not a question about an npm package | yes |
| `temporarily_unavailable` | a required source was down; declared to Telegraph as a failure | no |

The answer text starts with a one-line count; from processing version `p8` (deployed 9 Nov) a `found` answer adds a "Key changes" line with the first five changes. The full list, coverage notes, advisories and sources follow. The JSON also carries `changes`, `security`, `coverage`, `sources` and `confidence`.

## Limits

The code defaults; each can be set by an env var (`ORIGIN_RATE_PER_MIN`, `MAX_CONCURRENT_COMPUTE`, `MAX_TIME_MS`, `MAX_MODEL_CALLS`).

- Questions up to 2,000 characters.
- 120 requests a minute at the origin, 4 first-time answers computed at once; the YAML declares 2 a second and 1,000 a day.
- A first-time answer has 20 seconds and at most one model call (0.01 USDC, paid from the miner's own spend wallet to LLM miner 302 on Telegraph). Text the rules or the model did not read is reported as not covered.
- npm only. Sources: npm registry, GitHub releases, changelogs, migration guides (in the repository or on the package's own website), OSV.
- Answers are cached by question, source content and processing version; a repeat is served from the cache. Within an hour of the last full check, a repeat skips the sources entirely (about 0.45 s end to end), so an edited release note or a new advisory can show up to an hour late.

## Wallets, payout and ownership

- Payout wallet (registered the miner, receives earnings): `0x74f2840C8A564F791f50aD76c38EF078258588dC`.
- Spend wallet (pays the model calls): `0xe131…02A1`.
- Payout, as measured on 9 Nov: the buyer pays the floor (0.02 USDC at today's demand), Telegraph keeps 2%, and the remaining 98% is swapped to MACHINA at the end of each epoch and credited to the miner, to be claimed to the payout wallet. Earned so far: 0.0196 USDC, as 0.00368 MACHINA, from one paid call (our own test). Read it with `GET https://devnode.telegraphprotocol.com/v1/entitlements/miner/5083`.
- The same team runs this miner and the PR bot in this repository (`bot/`). The bot's purchases from this miner are related-party tests, not independent demand. The 30 evaluation-pool questions uploaded on 9 Nov are signed by the payout wallet, so they are openly ours. The organizers confirmed on 9 Nov that this is allowed as long as the miner does not train on them; it has no trained model and never reads them.
