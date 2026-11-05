Hand-written fixtures for the negative cases (T045). They are synthetic, not recorded: each one is the smallest
upstream response that reproduces its case. Packages `no-notes` and `@mono/a` and their repositories are invented.

- `npm/no-notes.json`: registry metadata with a repository, but the repository has no releases, no changelog
  and no matching tags.
- `npm/@mono__a.json`, `github/mono.releases.json`: a monorepo package whose only release (`v2.0.0`) does not
  name it.
- `github/empty.releases.json`, `github/empty.tree.json`: an empty release list and an empty file tree.
- `github/link-only.releases.json`: a major release whose notes only link to a migration guide.
- `github/changelog-pointer.releases.json`, `github/no-notes.CHANGELOG.md`: a major release whose notes only
  say "see the changelog", and the changelog that lists its breaking change.
