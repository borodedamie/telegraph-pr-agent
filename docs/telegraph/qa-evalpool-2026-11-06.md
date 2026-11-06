# QUESTION_ANSWERING_GENERAL evaluation pool (6 Nov 2026)

`GET https://devnode.telegraphprotocol.com/api/evalpool/status?intent_id=QUESTION_ANSWERING_GENERAL`, read at about 11:20 UTC, after the miner was registered (registrationId 5083, miner 7314). Unpaid read.

| Field | 2 Nov | 6 Nov |
| --- | --- | --- |
| Eligible rows | 232 | 403 (1 rejected) |
| Eligible submitters | 3 | 4 |
| `min_submitters` | 5 | 5 |
| Active snapshot | corpus `6853644d…`, 232 rows, epoch 1981 | corpus `2bbf3d55…`, 403 rows (197 qualification, 206 ranking), published 4 Nov, epoch 2015 |
| Current epoch | 1983 | 2026 |

The pool is still below `min_submitters`. The miner gate in SPEC §1 ("the evaluation pool is eligible") was not re-checked before registering on 6 Nov, so the miner was registered regardless. It answers direct calls by id. It cannot be scored or ranked on this intent until a fifth distinct eligible submitter joins.
