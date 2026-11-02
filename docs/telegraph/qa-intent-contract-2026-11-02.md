# QA intent contract, live snapshot

Captured 2026-11-02 08:20–08:37 UTC from `https://devnode.telegraphprotocol.com` with unauthenticated GET requests and one unpaid `POST /engine/v1/ask` (402 challenge only; nothing signed or paid). The live node is authoritative; rerun the commands below before implementing against this or submitting, and add a new dated file when the answers change.

## Commands

```bash
NODE=https://devnode.telegraphprotocol.com
I=QUESTION_ANSWERING_GENERAL
curl -fsS "$NODE/engine/v1/intents" | jq '.intents[] | select(.intent_id | startswith("QUESTION_ANSWERING"))'
curl -fsS "$NODE/engine/v1/intents/$I" | jq 'del(.miners)'
curl -fsS "$NODE/engine/v1/intents/$I/miners" | jq '.miners[] | {id, name, cost_per_call}'
curl -fsS "$NODE/api/miners?intent=$I" | jq '.[] | {id, name, activation_status, min_price_usdc, scored, scores}'
curl -fsS "$NODE/api/miners?intent=QUESTION_ANSWERING" | jq length    # family prefix → 0
curl -fsS "$NODE/api/evalpool/status?intent_id=$I" | jq .
curl -sS -D - -o /dev/null -X POST "$NODE/engine/v1/ask" -H 'Content-Type: application/json' \
  --data '{"intent":"'$I'","query":"What breaking changes were introduced in the npm package zod version 4.0.0?"}' \
  | grep -i '^payment-required:' | cut -d' ' -f2 | tr -d '\r' | base64 -d | jq .
```

## Intent

| Field | Value on 2 Nov |
| --- | --- |
| Canonical id | `QUESTION_ANSWERING_GENERAL` (`canonical: true`); the only id in the catalogue with the `QUESTION_ANSWERING` prefix |
| Class | `judgment` (the mission page describes the QA capability as hybrid; the live node does not) |
| Request schema | `null` |
| Response schema | `null`; `onchain.ready: false`, reason "the intent has no response format" |
| Scoring module | none (`wasm: []`, `wasm_count: 0`) |
| Miner count | 10 |

## Request shape

- `{"intent": "QUESTION_ANSWERING_GENERAL", "params": {...}}` is rejected with HTTP 400 `no_input_schema`: "intent QUESTION_ANSWERING_GENERAL has no input schema, so params cannot be checked; send it as a free-form query".
- `{"intent": "QUESTION_ANSWERING_GENERAL", "query": "<question>"}` and a bare `{"query": "<question>"}` both reach the payment step (HTTP 402). The first is the Engine auto-routing request the client should send.

## Providers and ranking

- `GET /engine/v1/intents/{id}/miners` lists the 10 miners with `id, name, slug, description, base_url, capabilities, cost_per_call, protocol`. It has **no rank or score fields**.
- `GET /api/miners?intent=QUESTION_ANSWERING_GENERAL` returns the same 10 miners with `activation_status`, `min_price_usdc`, `scored` and `scores[]`. With the family prefix `QUESTION_ANSWERING` it returns `[]`: the empty result seen on 1 Nov came from querying the prefix, not from a broken endpoint.
- All 10 are `active`, `min_price_usdc` 10000 (0.01 USDC). None has a `scores[]` entry for `QUESTION_ANSWERING_GENERAL`; two (LiveCert, ChainSight) have scores for other intents. There is therefore **no QA rank to record today**; show "rank unavailable".
- None of the 10 is a package-release source: BBC, IMF, World Bank, Hacker News (3), Crossref, OpenAlex feeds, plus two broad multi-intent hubs.

## Evaluation pool

| Field | Value |
| --- | --- |
| Eligible rows | 232 |
| Eligible submitters | 3 |
| `min_submitters` | 5 |
| Active snapshot | corpus `6853644d…`, 232 rows, activation epoch 1981 |
| Current epoch | 1983 |

The pool is below the five-submitter threshold, and the intent has no scoring module. A team miner registered on this intent has no visible path to a QA score until both change.

## Payment challenge (402 `accepts[]`)

| Scheme | Network | Asset | Amount | Pay to | Notes |
| --- | --- | --- | --- | --- | --- |
| `exact` | `eip155:11155111` | `0xcc194e1a843B658526D0D5C431f670028582Ae17` (USD Coin v2) | 10000 (0.01 USDC) | `0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b` | `maxTimeoutSeconds: 60`, per-request x402 |
| `escrow` | `eip155:11155111` | — | 10000 | same | Deducted from the caller's Telegraph escrow balance at the next epoch close; fund once with `EscrowFacet.depositUSDC`; EIP-191 `personal_sign` |

`x402Version: 2`, resource `/engine/v1/ask`, description "Payment required for LLM-routed inference."

## What this changes

- Client: send `QUESTION_ANSWERING_GENERAL` with a free-form `query` to `POST /engine/v1/ask`; do not send `params`; read the miner from the response.
- Result handling: with no response schema there is no canonical field shape to validate. Treat the answer as free text and validate it ourselves (package, version, sources); record `result_shape` and `field_status` only if the response carries them.
- Miner track: blocked on this intent (judgment class, no scoring module, 3 of 5 submitters). See SPEC §3.5.
