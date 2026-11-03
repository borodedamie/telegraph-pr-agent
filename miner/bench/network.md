# Miner network log

Addresses only. Keys live in gitignored local files and Vercel env vars.

| Date | Item | Value |
| --- | --- | --- |
| 2026-11-03 | Spend wallet (pays LLM miners) | `0xe131a61119ECA470dAA17A68cD7B1FcA1a3D02A1` |
| 2026-11-03 | Spend wallet funded: 1 test USDC minted from the bot wallet | tx `0x537ba82d5cd9001ff981d310fe7357476cb798b1e0bda8095b4cae146d9050dd` |
| 2026-11-03 | Payout wallet (receives payments; not registered yet) | `0x74f2840C8A564F791f50aD76c38EF078258588dC` |
| 2026-11-03 | Vercel project | `n30sk/telegraph-pr-miner` (separate team account), linked from `miner/` |
| 2026-11-03 | Preview deployment (stub) | `https://telegraph-pr-miner-mc5rppoiv-n30sk.vercel.app`. `/api/health` 200 with all upstreams and Redis ok; `/api/answer` 401 without the key, 400 without a query, 200 stub with the key; source files 404. |
| 2026-11-03 | Hosting plan (T021) | Vercel Hobby: a testnet hackathon entry with no real revenue. Revisit only if the miner takes real payments |
| 2026-11-03 | YAML validation (T019) | Passed in anjoman.ai/dashboard/earn (YAML URL from the branch, header key): "Endpoint validated — ready to register". First try failed with `on_chain: fields is required`, fixed by adding `on_chain.fields.strings`. Without the key the check failed with `auth failed: HTTP 401`. Vercel logs show the keyed validator call as `GET /api/answer` → `400`: it sent no usable `query` param, and the validator passed anyway, so it checks reachability and auth only. The param name the Engine sends on a real ask is still unverified. Not registered |
| 2026-11-03 | Vercel Authentication disabled on the project | Preview reachable without a bypass token: `/api/health` 200, `/api/answer` 401 without the key, `/package.json` 404 |
| 2026-11-03 | Upstash Redis | `telegraph-pr-miner-redis`, Free plan, connected to production, preview and development (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) |
| 2026-11-03 | Preview redeployed with the review fixes | `https://telegraph-pr-miner-pjq4sqnhf-n30sk.vercel.app`: `/api/health` 200 with all upstreams and Redis ok; `/api/answer` 401 without the key, 400 without a query, 200 stub with the key; `/src/auth.ts` 404. The preview YAML now points here |
