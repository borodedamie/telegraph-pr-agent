# Who does what

Plan: [HACKATHON-PLAN.md](HACKATHON-PLAN.md). Requirements: [SPEC.md](SPEC.md). Three people, three workstreams. Shared pieces (ledger records, Q&A answer handling, the canonical intent contract) are agreed in week 1 and not changed without telling the other two.

| | A — Miner | B — Action and agent | C — Ledger, dashboard, evidence |
| --- | --- | --- | --- |
| **Owner (GitHub handle)** | TBD | TBD | TBD |
| **Backup** | TBD | TBD | TBD |
| **Builds** | The package-release Q&A service (npm and PyPI; the Action itself is npm-only), its YAML, registration and evaluation data, only while the miner gate holds | The GitHub Action: lockfile scan, one mandatory Engine-routed Q&A purchase, draft PR, label trigger, fix job with the installer's LLM, secretless CI. Telegraph codegen/verification only as optional experiments after a provider passes tests | Attempt and receipt ledger, merge tracking, cost per merged PR and per useful answer, dashboard, README, demo video, evidence pack, public updates and developer outreach |
| **Week 1 (1–7 Nov)** | With B: canonical intent snapshot. Then: scoring class/module, `min_submitters` and eligible submitters, truth-source API and how it maps to checkable fields, active snapshot and epoch, response contract. Register only after these pass | Client: `QUESTION_ANSWERING_GENERAL` with a free-form `query` via `POST /engine/v1/ask`; read the returned miner. 402 quote from code. Controlled failed-delivery test (settlement, escrow credit, receipt). One tightly capped quality test on a real package question before any further paid calls; keep only useful answers as fixtures, keep unusable ones as failure evidence. Fixture repo: schedule, manual run, draft PR, label, unauthorised label, failing test, close, merge, malicious lifecycle script | Ledger schema: attempts (reserved → request_sent → delivered / failed_and_credited / unknown_needs_reconciliation), per-receipt purchases, merge outcomes; tests for retry, ambiguous attempt, decline and duplicate merge. First public update (build announcement) |
| **9 Nov** | Miner go/no-go (decision owner: TBD). No-go: stop the miner build, join B | — | — |
| **By 14 Nov** | If go: answers a zod question through the Engine with sources; measured p50/p95 | One full cycle on the fixture repo plus the failure and no-spend cases (PLAN acceptance list) | Dashboard shows cost per merged PR (`N/A` until a merge) for the fixture repo. Second public update: a real purchase and what it enabled |
| **By 1 Dec** | If go: active, scored and ranked on the exact canonical intent, with evidence; Miners-track pack | Minimum: one independent developer reproduces a run, plus one more independently verified use or repeat use. Target: installed on three repos outside the team | README, 2–5 min demo, evidence pack, five-question commercial summary. Third public update: technical tutorial (setup, intent discovery, lessons) |
| **Done when** | A stranger's agent gets a sourced answer from it through Telegraph routing | A reviewer installs the workflow on a fresh repo and gets a draft PR, a fix and a cost line | A judge reproduces a run from the README alone and finds every receipt |

## Public updates and developer activation

C coordinates; A and B supply the technical material. At least three updates on separate dates.

| Milestone | Content | Evidence kept |
| --- | --- | --- |
| Build announcement | The problem and why the agent buys release knowledge | Public URL and date |
| Working integration | A real purchase and the result it enables | Post or video, signal and receipt references |
| Technical tutorial | Setup, canonical intent discovery, reproduction, failure lessons | Tutorial URL, independent feedback |
| Developer activation | Invite developers to reproduce or test; answer their feedback | Issues, reproduction notes, external requests or contributions |

## Standing rules

- The agent's wallet and the miner's wallet are different and both are disclosed. Self-purchases and team-related wallets never count as independent adoption.
- The qualifying purchase uses Engine routing; the ledger records the miner the Engine returned. Manual provider selection is for controlled tests only and is labelled as our choice.
- Hackathon purchases, transactions, demos and adoption evidence come from 1 Nov–1 Dec 2026; release notes and registry data keep their original dates.
