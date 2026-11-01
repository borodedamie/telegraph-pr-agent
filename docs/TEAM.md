# Who does what

Plan: [HACKATHON-PLAN.md](HACKATHON-PLAN.md). Three people, three workstreams. Shared pieces (ledger row shape, miner answer shape) are agreed in week 1 and not changed without telling the other two.

| | A — Miner | B — Action and agent | C — Ledger, dashboard, evidence |
| --- | --- | --- | --- |
| **Owner** | Person 1 | Person 2 | Person 3 |
| **Builds** | The package-release `QUESTION_ANSWERING` service (npm, PyPI, GitHub release notes), its YAML, registration, evaluation-pool questions | The GitHub Action: scan, the four Telegraph purchases, draft PR, label trigger, fix job, secretless CI | Ledger schema, merge tracking, cost per merged PR, dashboard, README, demo video, evidence pack, public updates |
| **Week 1 (1–7 Nov)** | YAML validates; register on the current chain; `activation_status: active`; check `/api/evalpool/status` | Switch the client to `/engine/v1/intents/{intent}/miners`, `_GENERAL` ids and Ethereum Sepolia; get a 402 quote from code; 3–5 real paid QA calls on package questions saved as fixtures; fixture repo with schedule, manual run, draft PR, label, failing test, close, merge | New ledger schema (receipt hash key, step, attempt, merge rows) with tests for retry, decline and duplicate merge; build-announcement public update |
| **By 14 Nov** | Miner answers a zod or pydantic question with sources in under 10 s | One full cycle on the fixture repo, plus the failure case (patch fails typecheck, not pushed) | Dashboard shows cost per merged PR for the fixture repo |
| **By 1 Dec** | Ranked on `QUESTION_ANSWERING`; Miners-track pack (YAML, registration tx, sample answers, how to test quality) | Installed and used on at least three repos outside the team | README, 2–5 min demo video, evidence pack, five-question commercial summary, working-result public update |
| **Done when** | A stranger's agent gets a sourced answer from it through Telegraph | A reviewer installs the YAML on a fresh repo and gets a draft PR, a fix and a cost line | A judge reproduces a run from the README alone and finds every receipt |

Standing rules: the agent's wallet and the miner's wallet are different and both are disclosed; the agent buys from whichever miner is top-ranked, ours or not; nothing dated before 1 Nov is cited as evidence.
