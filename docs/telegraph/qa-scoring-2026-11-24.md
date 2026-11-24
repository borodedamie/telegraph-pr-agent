# QUESTION_ANSWERING_GENERAL scores, live snapshot 24 Nov 2026

Captured 24 Nov 2026 15:18 UTC from `https://devnode.telegraphprotocol.com` with unauthenticated GET requests. The live node is authoritative.

```bash
NODE=https://devnode.telegraphprotocol.com
curl -fsS "$NODE/api/miners?intent=QUESTION_ANSWERING_GENERAL"
curl -fsS "$NODE/api/evalpool/status?intent_id=QUESTION_ANSWERING_GENERAL"
curl -fsS "$NODE/v1/entitlements/miner/5083"
```

## Ranking, epoch 49 (scored 24 Nov 12:07 UTC)

| Rank | Miner | Score |
| --- | --- | --- |
| 4 | zk-qa-claims `7310082` | 0.7624 |
| 5 | textwire-question-answering `1900999019` | 0.707 |
| 6 | zk-qa-source `780019` | 0.6189 |
| 7 | zk-qa-proof `780031` | 0.5605 |
| 9–17 | nine miners, ours (`7314`, rank 11) among them | 0 |

17 miners are active on the intent. Ranks 1–3 and 8 are held by miners whose catalogue entry carries no QA score in this response.

Miner 7314: `registered_at` 2026-11-17T07:25:16Z (every miner on the node shows a registration date of 17–19 Nov, so the node was re-registered then; ours was first registered on 6 Nov), `total_requests_served` 145, `last_scored_epoch` 49, `min_price_usdc` 20000 (0.02).

## Evaluation pool

570 eligible rows from 6 eligible submitters (`min_submitters` 3), 338 quarantined (`rate_limited`), 6 rejected. Active snapshot `19efb9ba…`, published 18 Nov 15:49 UTC, 293 qualification and 277 ranking rows, activation epoch 11; current epoch 50.

## Scorer

`GET /engine/v1/intents/QUESTION_ANSWERING_GENERAL`: class `judgment`, evaluated `via: generic`, lifecycle state `registered` since 17 Nov, with the reasons "no response format" for input and output, and `onchain.ready: false`.

## Payout

`GET /v1/entitlements/miner/5083`: `lifetime` 944071 (0.944071 USDC), published epoch 49, claimable with `claimMinerEntitlement` and a Merkle proof. On 9 Nov the entitlement was paid in MACHINA; it is now stated in USDC.

## Not known

Why miner 7314 scores 0. The public API gives no per-question scores. It served paid requests through the node on 22–23 Nov (`p10` answer on fixture PR #2), so it is reachable. Possible causes: the new pool's general questions get `out_of_scope` from a package-only miner, or answers the general judge rates low. To ask Telegraph.
