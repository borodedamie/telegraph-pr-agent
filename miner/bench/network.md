# Miner network log

Addresses only. Keys live in gitignored local files and Vercel env vars.

| Date | Item | Value |
| --- | --- | --- |
| 2026-11-03 | Spend wallet (pays LLM miners) | `0xe131a61119ECA470dAA17A68cD7B1FcA1a3D02A1` |
| 2026-11-03 | Spend wallet funded: 1 test USDC minted from the bot wallet | tx `0x537ba82d5cd9001ff981d310fe7357476cb798b1e0bda8095b4cae146d9050dd` |
| 2026-11-03 | Payout wallet (receives payments; not registered yet) | `0x74f2840C8A564F791f50aD76c38EF078258588dC` |
| 2026-11-03 | Vercel project | `n30sk/telegraph-pr-miner` (separate team account), linked from `miner/` |
| 2026-11-03 | Preview deployment (stub) | `https://telegraph-pr-miner-mc5rppoiv-n30sk.vercel.app`. `/api/health` 200 with all upstreams and Redis ok; `/api/answer` 401 without the key, 400 without a query, 200 stub with the key; source files 404. Vercel Authentication still guards previews, so Telegraph cannot reach it yet |
| 2026-11-03 | Hosting plan (T021) | Vercel Hobby: a testnet hackathon entry with no real revenue. Revisit only if the miner takes real payments |
| 2026-11-03 | YAML validation (T019) | Not run: the public validator answered 405, and the dashboard sandbox needs the deployment reachable without Vercel Authentication |
| 2026-11-03 | Upstash Redis | `telegraph-pr-miner-redis`, Free plan, connected to production, preview and development (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) |
