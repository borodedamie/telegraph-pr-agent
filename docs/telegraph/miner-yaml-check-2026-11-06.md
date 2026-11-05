# Miner YAML and registry check (6 Nov 2026)

Read from the live docs (`https://anjoman.ai/docs/miners/yaml-config`), the dev node and Sepolia, for T062. No registration, no payment.

- `isCanonicalIntent("QUESTION_ANSWERING_GENERAL")` on the Telegraph Diamond `0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b` (Sepolia): `true`.
- `GET https://devnode.telegraphprotocol.com/api/miners`: 2009 miners.
  - Id `7314` and slug `package-release-intel` are unused.
  - 14 miners list `QUESTION_ANSWERING_GENERAL`, among them 302 `chainsight-oracle` (the LLM miner ours buys from), 4433 `livecert` ("Sourced Answers for Agents") and 9002 `txlens`.
- The YAML rules we rely on are as in the 3 and 4 Nov snapshots:
  - `on_chain` is accepted "for older nodes": the on-chain layout is now fixed per intent. If kept, `transform` is required and `min_price_usdc` is the floor price for x402 payment gating (for example `0.01`).
  - `limitations[]`: `code`, `message` required; `property: rate` with `value_num` and `window_seconds` declares a provider allowance the node checks before spending a caller's money. Only `MAX_BODY_SIZE`, `MAX_PARAM_SIZE`, `MAX_PARAM_VALUE` and `MAX_PARAM_COUNT` are machine-enforced codes.
  - `errors.message_path`, `status_path`, `success_values`; `signal_mapping` with `label_field`, `reason_field`, `confidence_field`.
- Where the price per call is set, if not in `on_chain.min_price_usdc`, is not stated on the YAML page.
