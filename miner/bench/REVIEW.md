# Reviewing the benchmark set

The benchmark ([transitions.json](transitions.json)) measures the miner against a list of what really changed in 30 npm upgrades. That list does not come from the miner: if it did, the benchmark could only confirm the miner's own output.

Claude drafts each case from the release material. At least two other models then check each case against the sources, using the rules below, and the draft is corrected from their findings. Every quote is checked word for word against its cited page. A person settles the points where the reviews disagree; each decision is recorded in that case's `expected.notes`.

## What to check for each positive case (`p01`–`p30`)

Read the release notes for every release after `from`, up to and including `to`. Use the GitHub releases page, `CHANGELOG.md` and the project's migration or upgrade guide, if it has one.

List every **breaking change**: a change that can make code that worked on `from` fail or behave differently on `to`. Count these:

- a removed or renamed API, option, export, CLI flag or config key;
- a changed default, return value, type or error;
- a dropped Node.js, browser, TypeScript or peer-dependency version;
- a module format change, such as ESM-only.

Don't count these:

- new features;
- bug fixes that only make documented behaviour work as documented;
- deprecations (record them separately, see below);
- internal refactors and dependency bumps that change nothing for the user.

For each breaking change, fill one entry in `expected.breaking`:

```json
{
  "version": "4.0.0",
  "change": "z.string().email() is deprecated in favour of z.email()",
  "migration": "Replace z.string().email() with z.email()",
  "source": "https://github.com/colinhacks/zod/releases/tag/v4.0.0",
  "quote": "the exact sentence from the source that states it"
}
```

- `version`: the release that introduced the change.
- `change`: one sentence in your own words.
- `migration`: what a user has to do, or `null` when the source does not say.
- `source`: the page where you found it.
- `quote`: copied exactly, so the benchmark can check that the miner cites the same text.

Deprecations go in `expected.deprecations`, in the same shape. Security fixes stay out of the list: the OSV check covers them.

## Recording the review

- `expected.reviewedBy` names the reviews a case went through: the model reviews and the quote check, with their dates.
- A change made because of a review, and a review finding that was not followed, are both noted in `expected.notes` with the reason.
- When a release is too large to review in full (zod 4.0.0, next 15.0.0), say so in `expected.notes`. Then list at least the changes in the release's own breaking-changes section.
- To review again, give a model the case, these rules and the full text of its sources, and ask for missing entries, entries that are not breaking, and quotes that are only a heading.

## Negative cases (`n01`–`n10`)

Each has an expected `outcome` and a `why`. Check only that the expected outcome follows the spec. Every negative answer must never suggest that the upgrade is safe (SC-004).

## What the benchmark then measures

- **Recall (SC-002)**: at least 80% of the reviewed breaking changes appear in the answer.
- **Evidence (SC-001)**: at least 90% of the answer's documented items quote text that exists in the cited source, at the right version.
- **Invented facts (SC-003)**: none. No made-up versions, dates or links.
- **Negative cases (SC-004)**: each one gets the expected outcome.
- **Partial coverage (SC-005)**: a partial answer names every release it did not cover.
- **Security (SC-012)**: each advisory conclusion matches the User Story 4 table.
