# Telegraph snapshot: miner YAML rules and ranking endpoints (3 Nov 2026)

Read on 3 Nov 2026 from https://anjoman.ai/docs/miners/yaml-config and the devnode (`https://devnode.telegraphprotocol.com`). Unpaid reads only. Re-check before registering.

## Miner YAML (docs)

- `endpoints[].external_path` is required. `path` is the path Telegraph exposes, and `external_path` is the upstream path the node forwards to.
- The schema rejects unknown keys.
- `id` is a numeric miner id that must be unused. Check with `GET /api/miners`.
- `auth`:
  - `type` is `none`, `header` (with `header_name`) or `bearer`.
  - Keys never go in the YAML. They are installed against the slug, signed by the registering wallet, after registration; before registration the install endpoint returns `404`.
  - If a top-level `auth` key does not resolve, the call goes out unauthenticated.
- `errors.status_path` / `errors.success_values`:
  - for APIs that return `200` on failure;
  - a non-success status is treated as a failure: the caller is not charged and no signal is recorded;
  - without `status_path`, every `200` is a charged success.
- Rate limits:
  - `rate_limit_per_sec` sets a client-side cap.
  - `limitations[]` entries with `property: rate` are checked by the node before it charges a caller.
  - Without either, the default is 600 calls per minute.
- `on_chain`:
  - `transform` (`direct` or `llm`) is required when the block exists.
  - `min_price_usdc` is a decimal amount, e.g. `0.01`.

## Ranking endpoints (devnode, intent `QUESTION_ANSWERING_GENERAL`)

| Endpoint | Status | Ranking data |
| --- | --- | --- |
| `GET /api/miners?intent=QUESTION_ANSWERING_GENERAL` | 200 | Per-miner `scores[]` with `intent_id`, `epoch_id`, `rank`, `score`, `scored_at`. `qa-crossref` had `QUESTION_ANSWERING_GENERAL` rank 2, score 0.9969, epoch 2001 |
| `GET /engine/v1/intents/QUESTION_ANSWERING_GENERAL/miners` | 200 | `count: 10`. Each miner has `id, name, slug, description, base_url, protocol, capabilities, cost_per_call`; no `rank` or `score` |
| `GET /leaderboard/miners` | 200 | `epoch: 2002`. `intents.<id>[]` with `miner_slug, score, rank, activation_status`; no `QUESTION_ANSWERING_GENERAL` key |

Catalogue entries for the existing QA miners had `auth`, `errors` and `rate_limit` all null.

## LLM miners (catalogue and one paid test)

- The x402 docs describe a payment rail only. There is no generic LLM endpoint, so LLM inference means calling a miner that runs a model.
- Text-generation miners in the catalogue:

  | Miner | Endpoint | Notes |
  | --- | --- | --- |
  | `901` `groq-llama31-instant-miner` | `POST /chat`, OpenAI-style `messages` | Groq llama-3.1-8b-instant; CHAT_COMPLETION rank 5 |
  | `7413` `aiwire-language-generation` | `GET /language-generation?prompt=` | |
  | `302` `chainsight-oracle` | `POST /gen`, `POST /chat` | |
  | `121262`, `5893375` | `POST /generate` | ngrok hosts |

  All of them quoted `min_price_usdc` 10000.
- Most `CONTENT_EXTRACTION_GENERAL` and `CHAT_COMPLETION_GENERAL` miners wrap data sources (BBC, Crossref and similar), not models.
- **Paid test, 3 Nov**: a direct call to `901` with a release-note extraction prompt.
  - The 402 offered `exact` and `escrow`, each at 10000.
  - Result: `200` after 43 s (`duration_ms` 33413). The body was `"Temporary inference error; please retry. Detail: AuthenticationError"`, with model `openai/gpt-oss-20b` and zero tokens.
  - Settled and charged, 0.01 test USDC, tx `0x89b471e3db68047fa3a3fdebc37e57e085b4a647dc423b7b95bf164f070f928b`.
  - Takeaway: a `200` from an LLM miner can hide a failure.
