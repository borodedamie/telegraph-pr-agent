# Breaking-change phrases in major-release notes (4 Nov 2026)

Why the deterministic pass reads phrases, which ones, and how well they did. Measured locally on free GitHub
reads; no paid call.

## Corpus

GitHub release notes of every major release (x.0.0, not a prerelease) of 89 popular npm packages: 309 releases,
284 of them with more than 200 characters of text. Many packages publish no GitHub releases and keep only
`CHANGELOG.md` (typescript, svelte, rxjs, dotenv, pg, …), so they are not in this corpus.

## How breaking changes are written in those 284 releases

| Case | Releases | Share |
| --- | --- | --- |
| A Breaking, Removed or Dropped heading (the rules before this change read these) | 167 | 59% |
| No such heading, but a phrase below finds breaking items | 74 | 26% |
| Nothing found: the notes only link to a guide or blog post, or are old free prose | 43 | 15% |

## Phrases

Each group is far more common in lines under Breaking headings (1,231 lines) than under Features or Fixes
headings (4,394 lines):

| Group | Examples | Breaking / Features+Fixes lines |
| --- | --- | --- |
| removed | "has been removed", a line starting "Remove…" | 130 / 40 |
| no longer | "no longer", "not supported anymore" | 66 / 32 |
| deprecated removed | "remove deprecated…", "deprecated X removed" | 51 / 22 |
| drop support | "drop support for", "dropped Node 14" | 47 / 15 |
| Node version | "requires Node", "minimum Node version", "Node >= 18" | 34 / 3 |
| use X instead | "use X instead" | 34 / 20 |
| renamed | "renamed", "rename X to Y" | 26 / 6 |
| previously | "previously" | 18 / 7 |
| now throws | "now throws", "will throw" | 11 / 5 |
| now required | "is now required", "now requires", "must now" | 11 / 1 |
| in favor of | "in favor of" | 11 / 4 |
| ESM only | "ESM-only", "pure ESM", "drop CommonJS" | 7 / 3 |
| replaced, default changed, changed signature | "replaced with", "to be `false` by default", "changed the signature" | rare but specific |

Counts come from a prototype of the patterns; the shipped list is in `src/extract/rules.ts`.

## Where the phrases apply

- Only to a line-start release (x.0.0, or 0.y.0): patches rarely break things, and phrases there would be noise.
- To bullets and to sentences of prose paragraphs ("Storybook 10 contains one breaking change: it's ESM-only").
- Not under a Fixes heading ("the overlay no longer crashes" is a fix), and not to tag-comparison diffs.
- Not to maintenance lines (tests, docs, lint, typos, unused, internal, refactor), outside code spans.
- "will be removed in a future version" is not a breaking change now; with "deprecat" it is a deprecation.
- A line-start release with no item whose notes link to a guide, blog post or release notes is reported as
  "not assessed", with the link, and the answer's confidence is capped at 0.5.

## Result on the same corpus, with `extractRules` itself

| | Releases with at least one item | Not assessed (link only) | Nothing found |
| --- | --- | --- | --- |
| Before (headings and explicit markers) | 177 of 284 | — | 107 |
| After (plus phrases) | 236 of 284 | 11 | 37 |

A random sample of 40 items found after the change: about 34 are real breaking changes (for example
"afterRender was renamed to afterEveryRender", "Calling `setState` with null no longer triggers an update",
"`ctx.throw` now requires a format of …"). The misses are lines like "Use original instead of immer draft for
perf", which match "instead" only. This is one person's reading of one sample, not a labelled benchmark;
the benchmark (T056) measures it properly.
