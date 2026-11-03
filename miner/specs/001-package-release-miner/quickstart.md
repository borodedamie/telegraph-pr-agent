# Quickstart: Package-release miner

Run from the repository root. Node 20, pnpm 9.

## Local

```bash
pnpm install
cp miner/.env.example miner/.env        # MINER_API_KEY, GITHUB_TOKEN, MINER_SPEND_KEY, LLM_MINERS, KV_REST_API_URL (optional locally)
pnpm --filter ./miner test               # unit + fixture tests, no network
pnpm --filter ./miner dev                # vercel dev, serves http://localhost:3000/api/*
```

Every `/api/answer` call needs the key from `miner/.env`:

```bash
KEY=$(grep '^MINER_API_KEY=' miner/.env | cut -d= -f2-)
curl -H "X-Telegraph-Key: $KEY" "http://localhost:3000/api/answer?query=What%20changed%20in%20zod%20from%203.23.8%20to%204.0.0%3F"
curl -i "http://localhost:3000/api/answer?query=x"            # no key → 401
curl http://localhost:3000/api/health
```

Without `KV_REST_API_URL` the miner uses an in-memory cache. Without `MINER_SPEND_KEY` or `LLM_MINERS` it runs the deterministic extractor only and buys nothing. Unit and fixture tests never buy: the LLM miner is stubbed. The answer says prose changes may be missing, and the extractor mode is part of `PROCESSING_VERSION`, so these answers never share a cache entry with full ones.

## Smoke checks

| Question | Expected |
| --- | --- |
| `What changed in zod from 3.23.8 to 4.0.0?` | `found`, documented items with verified excerpts |
| `What changed in left-pad-does-not-exist-xyz from 1.0.0 to 2.0.0?` | `not_found`, no source links invented |
| `What changed in zod from 3.23.8 to 99.0.0?` | `not_found`, closest published versions named |
| A package whose target B is still inside an OSV affected range (picked with the OSV fixtures in Phase 5) | `found`, security warning that B is still affected |

## Benchmark

```bash
pnpm --filter ./miner bench              # runs the 30 + 10 benchmark set, writes miner/bench/report.md
```

The report shows SC-001 to SC-006, SC-008, SC-011 and SC-012 per transition, plus latency and cost.

## Deploy

```bash
cd miner && npx vercel --prod            # project root: miner/; env vars set in the Vercel dashboard
```

Production URLs: `https://<project>.vercel.app/api/answer` and `/api/health`.

## Telegraph

1. Validate `specs/001-package-release-miner/contracts/telegraph-miner.yaml` with the deployed `base_url` at https://anjoman.ai/dashboard/earn, and sandbox-test the endpoint (plan phase 1).
2. Register from the miner's payout wallet, which is not the bot's.
3. Install the `X-Telegraph-Key` value against the slug, signed by the same wallet, and set the same value as `MINER_API_KEY` in Vercel.
4. Run the network acceptance test (spec User Story 5) and record each step in `miner/bench/network.md`.
