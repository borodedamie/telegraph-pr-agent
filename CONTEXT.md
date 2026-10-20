# Context

## Glossary

| Term | Meaning | Notes |
|---|---|---|
| CutoffTrigger | Deterministic event: a PR references a package version whose registry release date is after `modelCutoff`. | The only thing that starts the buy pipeline. Rejected alternative: model self-report (ADR 0001). |
| modelCutoff | Config constant: the documented training-cutoff date of the bot's model. | Quoted in the PR memo for the narrative; trigger logic never asks the model anything. |
| Purchase / Receipt | One x402 payment to one miner for one intent; fields: intent, minerId, amountUsdc, txHash, status. | Append-only ledger rows; the spend panel is a view over this table. |
| VerifiedPatch | A code patch that passed both `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` purchases. | Never pushed if either verification failed or was not bought. |
| CostPerMergedPR | Sum of Purchase amounts attributed to a PR that was subsequently merged. | Headline dashboard metric; joins ledger to MergeEvent. |
| MergeEvent | GitHub merge of a VerifiedPatch PR. | Human action — deliberate, keeps the human leg visible. |
| SpendDashboard | Public no-login web URL showing receipts, tx hashes, CostPerMergedPR, and the real-vs-testnet boundary line. | The hackathon "live demo URL". |
| BudgetCapUsdc | Per-PR spending ceiling enforced against the live 402 quote before each Purchase. | Kill switch companion; protects against demand-multiplier spikes. |
