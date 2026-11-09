# How QUESTION_ANSWERING_GENERAL is scored, live snapshot

Captured 8–9 Nov 2026 from `https://devnode.telegraphprotocol.com` with unauthenticated GET requests, and from the docs pages [How it works](https://docs.telegraphprotocol.com/docs/protocol/how-it-works), [Contribute evaluation data](https://docs.telegraphprotocol.com/docs/scoring/contribute-evaluation-data) and [Build an evaluator adapter](https://docs.telegraphprotocol.com/docs/scoring/build-a-scoring-module) (updated 1 Nov). The live node is authoritative; rerun the commands before relying on this.

## Commands

```bash
NODE=https://devnode.telegraphprotocol.com
I=QUESTION_ANSWERING_GENERAL
curl -fsS "$NODE/engine/v1/intents/$I" | jq 'del(.miners)'
curl -fsS "$NODE/api/wasm?resolve=$I" | jq .resolve
curl -fsS "$NODE/api/wasm?intent=GENERIC" | jq '.intents.GENERIC.champion'
curl -fsS "$NODE/api/evalpool/status?intent_id=$I" | jq .
curl -fsS "$NODE/api/miners?intent=$I" | jq '[.[] | {id, name, s: [.scores[]? | select(.intent_id == "'$I'")]}]'
```

## Class: judgment, not hybrid

`GET /engine/v1/intents/QUESTION_ANSWERING_GENERAL` returns `class: judgment` (unchanged since 2 Nov). The Model Economy mission page calls the QA capability hybrid; the node does not.

The docs define the three classes:

| Class | Scored by |
| --- | --- |
| deterministic | a comparator: the miner's value against a reference value from truth sources, within a tolerance |
| hybrid | a comparator score fused with a model's judgment |
| judgment | a model-based evaluator only: no reference answer, no fact check |

## The scorer

`GET /api/wasm?resolve=QUESTION_ANSWERING_GENERAL` on 8 Nov:

```json
{ "class": "judgment", "served_by": "GENERIC", "inherited": true, "scorer": "judgment", "routed": true, "generic_fallback": true }
```

No module is registered for this intent or its family; it is scored by the `GENERIC` fallback adapter: registration 900005, stage `canonical`, registered 2 Nov 11:14 UTC, `wasm_runnable_url: manual-seed`, author `0x71ca4df7a1931609c9060058b899ffdf79f384d0`.

Per the docs, an evaluator adapter is a LoRA delta plus a reward head on one shared Foundation Model, ModernBERT-base. It reads the question and the miner's answer, **up to 512 tokens**, and returns a score from 0 to 1. Every validator runs the same model, so every validator computes the same score. A challenger adapter replaces the canonical one only by beating it on the hidden half of the pool.

How the per-question scores become one miner score is not stated in the pages read.

## Questions miners are asked

Each epoch (1 hour on the testnet), miners are ranked on questions from the ranking half of the intent's evaluation pool, sampled evenly across contributors. The other half is hidden and only tests challenger adapters. Spot checks, about hourly, test liveness only (a non-empty answer).

Pool on 8 Nov 22:40 UTC: 426 eligible rows from 5 eligible submitters (`min_submitters` 5); active snapshot `93d22bdb…`, 210 qualification and 216 ranking rows, activation epoch 2040; current epoch 2043.

On 9 Nov the team uploaded 30 package-upgrade questions, each with a better and a worse answer, signed by the miner's payout wallet `0x74f2…88dC` (see `miner/bench/network.md`): 30 accepted, 30 admitted, 0 rejected. Admitted rows join the pool at the next freeze.

## Scores, epoch 2042 (8 Nov 12:38 UTC)

17 miners scored on the intent. Ours, miner 7314, was rank 11 with score 0.7955; it was rank 8 with 0.944 on the earlier 4-submitter pool. Top three: BBC QA Feed 0.9966, ChainSight 0.9792, PREFLIGHT 0.9566. Not confirmed, but likely: the larger pool's general questions get `out_of_scope` or `needs_clarification` from our miner, which a general judge rates low.
