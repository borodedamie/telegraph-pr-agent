# Using the Package Release Intel miner

A Telegraph miner that answers one question: **what changed in an npm package between two versions?**

You get the breaking changes, deprecations and security fixes for every release in that range. Each item quotes the release notes word for word and links to its source (GitHub release, changelog or migration guide). Known advisories are checked against OSV. Releases that could not be read are named in the answer, not guessed.

## Calling it

| | |
| --- | --- |
| Miner id | `7314` (slug `package-release-intel`) |
| Intent | `QUESTION_ANSWERING_GENERAL` |
| Price | 0.02 USDC per answer (testnet) |

Ask it by id. Engine auto-routing sends these questions to a web-search miner instead.

```
POST https://devnode.telegraphprotocol.com/engine/v1/ask/7314
{"method":"GET","endpoint":"/answer","payload":{"query":"What changed in express from 4.21.0 to 5.0.0?"}}
```

The call is paid with x402, like any Telegraph ask.

## Asking well

- One npm package per question, with both versions, oldest first: `What changed in zod from 3.23.8 to 4.0.0?`
- `Our app runs express 4.21.0; what breaks in 5.0.0?` also works.
- Put the package name right before the first version.
- npm only. At most 2,000 characters.
- A first answer takes a few seconds, up to about 20 s for a large jump. A repeat comes from the cache in under a second.

## What comes back

| `outcome` | Meaning | Charged |
| --- | --- | --- |
| `found` | changes listed with quotes and sources | yes |
| `not_found` | no usable release notes, or the version does not exist (the closest published ones are named) | yes |
| `needs_clarification` | the package or versions are unclear | yes |
| `out_of_scope` | not a question about an npm package | yes |
| `temporarily_unavailable` | a source it needs was down | no |

Main fields:

- `answer`: readable text, a one-line count, the key changes, then the full list.
- `changes`: each item with its kind, version, quote (`excerpt`) and `sourceId`.
- `coverage`: which releases were read, and which were not and why.
- `security`: advisories, and whether the target version fixes them.
- `sources`: the URLs everything was taken from.

## How good it is

On 38 reviewed upgrades it finds 67.1% of the breaking changes by word matching, and every quote is checked against its source: [bench/report.md](bench/report.md). How it works, its limits and costs: [README.md](README.md).

## Feedback

If you buy an answer, a reply with your receipt hash helps us, and so does telling us where an answer was wrong: open an issue in this repository.
