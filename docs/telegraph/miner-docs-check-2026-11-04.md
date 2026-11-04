# Telegraph snapshot: miner docs checked against the miner (4 Nov 2026)

Read on 4 Nov 2026 from https://anjoman.ai/docs/miners/yaml-config, /docs/miners/validation-api,
/docs/miners/miner-registration, /docs/using/engine-ask, /docs/using/intents, and
`GET https://devnode.telegraphprotocol.com/engine/v1/intents/QUESTION_ANSWERING_GENERAL`. Unpaid reads only.
Compared with `miner/specs/001-package-release-miner/contracts/telegraph-miner.yaml` and the miner code.

## Matches

- YAML: the required keys, a closed schema, `endpoints[]` with `path`, `external_path`, `method`, `description`
  and `intents`, `params.query.required`, `auth.type: header` with `header_name`, `semantics.supported_intents`,
  and `signal_mapping` with `label_field`, `reason_field` and `confidence_field` (0–1).
- `errors.status_path` / `success_values`: a value not listed is a failure and is not charged. This is how
  `temporarily_unavailable` is declared.
- `on_chain.min_price_usdc` floor is 0.01 USDC; ours is 0.01.
- `limitations` with `property: rate`: counted node-wide per miner. Without one, the backstop is 600 calls per minute.

## Differences and open points

- `on_chain.fields` and `on_chain.request` are legacy: "Jobs no longer read" them. The dashboard validator
  still required `fields` on 3 Nov, so the block stays.
- Timeout: "Each endpoint gets its own timeout (30 seconds on the default node configuration)", and
  "a 20-second endpoint will time out under real traffic". The production timeout is not documented. The
  miner's worst case is a 20 s time budget (`MAX_TIME_MS`) plus up to 5 s of lock wait, so a cold answer
  with the model pass could exceed it.
- `QUESTION_ANSWERING_GENERAL` is a judgment intent with `request: null` and `response: null`
  ("the intent has no response format"). The routed free-form path does not document the field name it
  sends to the miner. The direct native path sends `payload` as query parameters for `GET`. T019 step 3 is
  still open.
- With no response format, Telegraph shaping cannot apply. The raw answer is what is stored and signed, and
  a raw fallback "still returns 200 and still settles".
- Registration needs MACHINA for the bond (1 for the first intent), Sepolia ETH for gas, and a non-zero
  fee address. After activation there is a 7-day grace period with a flat 5% of routed traffic.
- The validation API (`POST /dashboard/validate`) returns 404; use the web interface.
