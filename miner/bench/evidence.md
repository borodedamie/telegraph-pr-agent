# Miners-track evidence (FR-028)

The package-release miner's submission evidence in one place, as of 10 Nov 2026. Every value links to where it was
recorded; only the five sample answers were collected for this page.

## Miner

| Item | Value | Recorded in |
| --- | --- | --- |
| What it answers | "What changed in `<npm package>` from A to B?": breaking changes, deprecations and security fixes per release, each with a quote from the release material, coverage of every release between A and B, and an OSV advisory check | [`miner/README.md`](../README.md) |
| Intent | `QUESTION_ANSWERING_GENERAL` (free-form question) | [`contracts/telegraph-miner.yaml`](../specs/001-package-release-miner/contracts/telegraph-miner.yaml) |
| Endpoint | `https://telegraph-pr-miner-n30sk.vercel.app/api/answer` (Vercel Hobby, Upstash Redis free tier) | [`network.md`](network.md), 6 Nov |
| Registration | `registerMiner` tx `0xffa82f094ebc6146993a00a80696d733c2ba76417608325c05e7ca85576a4157` (Sepolia, block 12073611), registrationId 5083, miner id 7314, slug `package-release-intel`, active since 6 Nov | [`network.md`](network.md), 6 Nov |
| Payout wallet | `0x74f2840C8A564F791f50aD76c38EF078258588dC` | [`network.md`](network.md), 3 Nov |
| Spend wallet (pays LLM miners for extraction) | `0xe131a61119ECA470dAA17A68cD7B1FcA1a3D02A1` | [`network.md`](network.md), 3 Nov |

## Network tests

| Test | Result | Recorded in |
| --- | --- | --- |
| YAML validation against production | "Endpoint validated — ready to register" with the key; `401` without it | [`network.md`](network.md), 6 Nov |
| API key install on the node | `updated: true`, `validated: true` | [`network.md`](network.md), 6 Nov |
| Direct paid ask, `POST /engine/v1/ask/7314` | Served by our miner, 0.02 USDC, settlement tx `0xd753f9081329fc6bbeb1a105580462fcce232c7eb55855bc8f61673b4010e52a`; `found`, 70 breaking changes for express 4.21.0 → 5.0.0 | [`network.md`](network.md), 6 Nov |
| Routed ask, `POST /engine/v1/ask` | Classified as `WEB_SEARCH_GENERAL` and sent to another miner, not ours | [`network.md`](network.md), 6 Nov |
| Ranking on `QUESTION_ANSWERING_GENERAL` | Rank 6 of 17, score 0.9732 at epoch 2046 (rank 11, 0.7955 at epoch 2042). Measured with our own 30 evaluation rows in the pool (1 of 6 contributors, allowed by the organizers), so not independent evidence of quality | [`network.md`](network.md), 8–9 Nov; [`docs/telegraph/qa-scoring-2026-11-09.md`](../../docs/telegraph/qa-scoring-2026-11-09.md) |
| Outage test (`SIMULATE_UPSTREAM_OUTAGE` on production) | Not run | — |

## Quality: benchmark

38 cases (30 reviewed positive cases, 8 negative), run against a preview on 5 Nov ([`report.md`](report.md),
[`judge-report.md`](judge-report.md)).

| Criterion | Result | Target |
| --- | --- | --- |
| SC-001 every quote found in its cited source | 673/673 | ≥ 90% |
| SC-002 recall of reviewed breaking changes | 67.1% by word matching; 82.6% with matches counted by an LLM judge | ≥ 80% |
| SC-003 invented versions, dates or links | 0 | 0 |
| SC-004 negative cases answered right, no safe-upgrade claim | 8/8 | all |
| SC-005 coverage names every release in range | 38/38 | all |
| SC-006 repeats byte-identical | 38/38 | all |
| SC-012 security conclusions match OSV | 38/38 | all |

Re-run on production `p9` on 11 Nov (T071) with LLM miner 7413 and up to two model calls: the same 67.1% word-match
recall case for case, so the model pass adds no reviewed change; every matched change comes from the rules. SC-001,
SC-003 to SC-006 and SC-012 still pass. The LLM-judge figure (82.6%) is from the 5 Nov run and was not re-run.
7413 takes prompts up to 8,000 chars, so long release notes are cut and those releases are reported `truncated`.

## Latency and cost

| Item | Value | Recorded in |
| --- | --- | --- |
| First-time answer, p50 / p95 | 2.1 s / 9.8 s (37 answers, 11 Nov production `p9`; 4.3 s / 11.2 s on the 5 Nov preview) | [`report.md`](report.md) |
| Repeat on production, after the repeat pointer | p50 433 ms, p95 466 ms, max 513 ms (one question, 15 repeats, 9 Nov); target under 500 ms | `network.md`, 9 Nov (PR #18) |
| Price per answer | 0.02 USDC floor on the direct ask | [`network.md`](network.md), 6 Nov |
| Our cost per first-time answer | Production since 11 Nov: up to two LLM-miner calls at 0.01 USDC (`MAX_MODEL_CALLS=2`, `MAX_MODEL_COST_USDC=0.02`); 24 calls, 0.23 USDC over 37 benchmark answers; repeats cost nothing | [`report.md`](report.md) |
| Payout so far | 0.0196 USDC accrued (0.02 less the 2% protocol fee), credited as 0.00368 MACHINA at epoch 2045, claimable, not claimed. From the one paid test, which is related-party | [`network.md`](network.md), 9 Nov |

## Five sample requests and answers

Bought on 10 Nov 2026 from the bot wallet with the bot's own x402 client, `POST /engine/v1/ask/7314` (direct),
0.02 USDC each, 0.10 in all (approved). Production ran processing version `p8`. Each file in
[`samples/`](samples/) holds the question, the time, the settlement tx, the receipt and signal hashes and the
miner's full answer JSON. The answers are the miner's output as served, untrusted like any miner answer.

| # | Question | Outcome | Answer | Time | Settlement tx |
| --- | --- | --- | --- | --- | --- |
| 1 | What changed in react from 18.3.1 to 19.0.0? | found | 83 breaking, 3 deprecations; 1 of 1 release covered | 14.3 s | `0x1daba341036a33f678dd9447cd1194d9bfc2673bf90caf730c07246d6e71a5e2` |
| 2 | What breaks if I upgrade vite from 5.4.0 to 6.0.0? | found | 27 breaking; 1 of 22 releases covered (21 truncated); 21 OSV advisories | 13.5 s | `0x2ed336f8c0acde10d32233bea51937816a8a0a1b4c66f63553a699fe07abce5b` |
| 3 | What changed in got from 8.0.2 to 11.0.0? | found | 47 breaking; 40 of 40 releases covered; 1 OSV advisory | 11.0 s | `0x200cfc65bcca3598c0432dd0762adb41c534ea3eb19f5aec049c416b82db90ea` |
| 4 | Is upgrading lodash from 4.17.20 to 4.17.21 enough to fix its known advisories? | not_found | lodash publishes no release notes for 4.17.21; the answer still lists the 4 OSV advisories with their conclusions | 8.2 s | `0xc7d31149646b40b1a806f2869eafc4ea2780507f7c0831b90197a1e4b7473cc0` |
| 5 | What changed in zod from 3.23.8 to 4.9.99? | not_found | "zod has no published version 4.9.99; the closest published version is 4.6.7" | 12.6 s | `0xc3ce61964297f4e26d7f5f99b81447bbb393546751ad93d9d276b0646dde3a74` |

All three found answers are rules only (processing version `…-nollm-rules_only`): the model pass did not run, and
each says so in its text. Reproduced locally the same day with a free stand-in for the model:

- react: the 19.0.0 release notes are one section larger than `MAX_MODEL_INPUT_CHARS` (24,000), so no call is made.
  Coverage still reads complete, because a section the model could not take is only marked not covered when a
  model call ran.
- vite: retrieval took about 11 s of the 20 s budget, leaving less than the 12 s a model call needs (`model_time`).
- got: a 23,425-char call is made. On production LLM miner 302's failure counter stood at 2 right after the
  samples, so its call failed; the reason is not known (production logs were not readable through the API).
