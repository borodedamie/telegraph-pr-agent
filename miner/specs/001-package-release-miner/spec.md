# Feature Specification: Package-release miner

**Feature Branch**: `miner_init`

**Created**: 2026-11-03

**Status**: Draft (revised after two reviews, 2026-11-03)

**Input**: User description: "A Telegraph miner that answers what changed in a package between two versions, so coding agents (our PR bot first) can migrate code to releases newer than their model's knowledge cutoff."

## Context

On 3 Nov 2026 two paid test questions about the zod 3 → 4 upgrade went unanswered on the Telegraph network. One went to the best general question-answering provider. The other went through automatic routing, which re-classified it as a web search. Neither returned a source or a usable answer. The network covers dependency vulnerabilities, but nothing covers API changes between package versions.

This miner fills that gap. It also supplies the PR bot ([docs/SPEC.md](../../../docs/SPEC.md)), which cannot produce a migration without this information, and it is the team's Miners-track (02) entry.

**Governing principle:** the miner must never produce a migration answer that looks complete when its evidence is incomplete. This governs source selection, version resolution, answer generation, caching and the acceptance tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sourced migration answer for a version change (Priority: P1)

A coding agent upgrading a dependency asks what changed in a named npm package between version A and version B. The miner answers with:

- a short summary;
- the breaking changes, each with a migration step;
- the deprecations;
- for every item, the evidence that supports it, the version it applies to and a link to the source.

**Why this priority**: This is the whole product. Without it the PR bot cannot migrate code past its model's cutoff, and no one else on the network offers it.

**Independent Test**: Ask about a well-documented transition, such as zod 3.23.8 → 4.0.0. The answer lists the documented breaking changes, and every listed item is supported by its quoted evidence in the linked source for the right version.

**Acceptance Scenarios**:

1. **Given** a question naming an npm package and two published versions, **When** the miner answers, **Then** the answer names the package, the resolved "from" and "to" versions and the target release date. It lists breaking changes and deprecations, each with a migration step, its evidence, its version and a source link.
2. **Given** a question naming a package and only a target version, **When** the miner answers, **Then** it assumes a "from" version per FR-004, says so explicitly, and labels the choice as an assumption. For a target of `0.5.0` the assumed "from" is the latest stable version below `0.5.0`, not a version from a nonexistent preceding major.
3. **Given** a question whose package or versions cannot be resolved unambiguously (for example "what changed in React after 18?"), **When** the miner answers, **Then** the outcome is "needs clarification" and the answer names what is missing. It does not guess.
4. **Given** the same question asked twice, **When** the sources have not changed in between, **Then** both answers are identical.
5. **Given** a transition that crosses intermediate releases (zod 3.23.8 → 4.0.0 crosses 3.24.x and 3.25.x), **When** the miner answers, **Then** it considers every release between A and B, and states whether coverage is complete or which releases it could not cover.

---

### User Story 2 - Honest "not found" (Priority: P1)

The agent asks about a package or version change for which no usable release information exists. The miner says so plainly instead of guessing.

**Why this priority**: A confident wrong answer makes the PR bot write broken code and erodes trust in paid answers. Honest absence is part of the core value, and a valid "not found" is a billable answer, not a failure.

**Independent Test**: Ask about a package that publishes no release notes or changelog. The answer is "not found", lists no changes, names the places that were checked, and does not suggest the upgrade is safe.

**Acceptance Scenarios**:

1. **Given** a package with registry metadata but no version-specific release material, **When** the miner answers, **Then** the outcome is "not found", no changes are listed, and the checked sources are named.
2. **Given** a version that does not exist in the registry, **When** the miner answers, **Then** it says the version was not found and names the closest published versions.
3. **Given** a question that is not about a software package, **When** the miner answers, **Then** the outcome is "out of scope".
4. **Given** release material exists but cannot be tied to the requested version, **When** the miner answers, **Then** it does not borrow another version's notes. It reports that version as not covered.

---

### User Story 3 - Multi-version jumps with honest coverage (Priority: P2)

The agent asks about a jump across many releases, for example 1.8.0 → 5.0.0. The miner considers every relevant published release between A and B, not only major boundaries. 0.x packages and minor releases can also break or deprecate things. The answer states exactly which releases it covered and which it could not.

**Why this priority**: Real projects often lag far behind. An incomplete answer that looks complete is more dangerous than no answer. Basic coverage of the releases between A and B is already part of User Story 1. This story adds what large jumps need: many releases within fixed model and time budgets, grouping, and naming every release cut by a budget.

**Independent Test**: Ask about a multi-major jump where one intermediate release has no notes. The answer includes the documented intermediate changes, each marked with its version, and names the uncovered release.

**Acceptance Scenarios**:

1. **Given** a question spanning many releases, **When** the miner answers, **Then** each listed change states the version in which it happened.
2. **Given** some intermediate releases have no release material, **When** the miner answers, **Then** the coverage is marked partial and every uncovered release is named.
3. **Given** all relevant releases are covered, **When** the miner answers, **Then** the coverage is marked complete.

---

### User Story 4 - Security fixes in the upgrade (Priority: P1)

When an upgrade from A to B fixes security problems, the answer says so clearly. It combines two sources:

- **Release notes**: security fixes documented between A and B, extracted like any other change, with any CVE or GHSA identifiers they mention. Notes often mention a fix before advisory databases do.
- **The OSV advisory database**: known advisories affecting A or B, with their complete affected ranges. OSV is the authority for affected and fixed version ranges.

The answer then states, per advisory, whether B fixes it. B is checked against the advisory's complete affected data (every range and every listed version), not against a single "first fixed" version, because one advisory can be fixed in one line and still affect a later one. A newer version is never presented as a security fix without evidence.

The security section always states whether the advisory check was complete, partial or unavailable. When OSV cannot be reached, the migration answer is still delivered, and its security section says the check was unavailable. It never says "no known advisories" in that case.

**Why this priority**: It turns "should we upgrade" into a concrete reason that the PR bot states in the PR. It stays inside the migration answer: the miner does not become a vulnerability database, and it does not register for a security intent.

**Independent Test**: Ask about a transition where A has a published advisory fixed at or before B, and the release notes mention the fix. The answer names the advisory, its severity and fixed version, quotes the release-note evidence, and concludes that the upgrade addresses it.

**Acceptance Scenarios**:

| Advisory database says | Release notes say | Answer concludes |
| --- | --- | --- |
| A affected, fixed at or before B | Fix documented | The upgrade addresses the advisory |
| A affected, fixed at or before B | Fix not mentioned | The upgrade addresses the advisory, per the advisory's fixed version |
| No known advisory | Security fix documented | A documented security improvement, with its quote |
| A affected, still affected at B | No applicable fix | Warning: the upgrade does not resolve it |
| No evidence either way | Nothing found | No security claim is made |
| Fixed in an earlier line, affected again in B's line | Any | Warning: B is still affected, despite being newer than A |
| A not affected, B affected | Any | Warning: the upgrade introduces a known advisory |
| Check unavailable | Any | Release-note items are shown; the advisory check is reported as unavailable |

---

### User Story 5 - Purchasable, and eventually discoverable, on Telegraph (Priority: P2)

Any agent on the Telegraph network can buy an answer from the miner, pay per request, and get a reply quickly and reliably. Being purchasable and being chosen by Telegraph's automatic routing are separate milestones. The second depends on the network scoring the miner and is not guaranteed.

**Why this priority**: The miner is worthless as a product and as a hackathon entry if buyers cannot reach it. Honesty about discoverability matters for the submission.

**Independent Test**: An agent whose wallet the team does not control buys one answer from the miner through Telegraph. It receives the answer and an individual receipt, the signal can be retrieved, and the settlement can be verified independently.

**Acceptance Scenarios** (network acceptance test, each recorded separately):

| Step | Required result |
| --- | --- |
| Canonical intent discovery | Exact id read from the live catalogue at registration time |
| Registration file validation | Accepted |
| Registration | Successful, with payout wallet recorded |
| Activation | Active |
| Purchase sent to this miner through Telegraph | Answer delivered, receipt issued |
| Automatic routing | Whether the miner is eligible is recorded, not assumed |
| Score and rank | Recorded, or documented as unavailable |
| Independent purchase | Successful purchase by an unrelated agent, with receipt, signal and settlement evidence |

Additional scenarios:

1. **Given** a required upstream source is temporarily unavailable, **When** the miner is asked, **Then** the outcome is "temporarily unavailable", never "not found" and never an error page, and the buyer is not charged.
2. **Given** a delivered "not found" answer, **When** payment is accounted, **Then** it counts as a valid paid answer, distinct from a delivery failure.
3. **Given** a request that reaches the miner's address directly, without Telegraph's credential, **When** the miner receives it, **Then** it refuses it without doing any work.

---

### Edge Cases

- **0.x packages:** minor releases can break things, so the "from" default uses the preceding minor line (FR-004). A `0.0.z` target with no "from" gets "needs clarification".
- **Prereleases:** a prerelease (`5.0.0-beta.2`) is answered as asked and marked as a prerelease.
- **Scoped packages:** names like `@scope/name` are supported. A similarly named package is never substituted.
- **Version ranges:** a range (`^4.1`) is resolved against the registry to the highest matching published version, and the resolved version is reported.
- **Monorepos:** the repository hosts several packages. Release material for other packages in it is never used, and tags such as `package@4.0.0` or `package-v4.0.0` are matched to the requested package only.
- **Shared release notes:** one release note covers several package versions. Only the parts that name the requested package and version are used.
- **Tag comparisons:** a tag comparison shows hundreds of unrelated changes. Diff evidence is labelled as repository evidence, never presented as a documented breaking change. Commit messages or file names alone are not evidence of a change; the changed code is. A truncated comparison makes coverage partial.
- **Repository missing or moved:** the miner says where it looked.
- **Huge histories:** the work stays within fixed budgets. If coverage is cut short, the answer says so.
- **Malicious source text:** text that tries to give instructions is treated as content, never followed.
- **Bursts:** the same popular transition is asked many times in a short window. Answers stay identical, and upstream sources are not hammered.

## Requirements *(mandatory)*

### Functional Requirements

**Request and resolution**
- **FR-001**: The miner MUST accept a free-form question and turn it into a normalized request: ecosystem, package, "from" version or none, "to" version or none.
- **FR-002**: The first release MUST support npm only. It MUST accept these input forms: package names, scoped names, exact versions, explicit ranges and explicit from/to comparisons.
- **FR-003**: Package identity and versions MUST be resolved against the registry deterministically. The miner MUST never substitute a similarly named package.
- **FR-004**: When only the target version is given, the "from" version MUST default to, and be labelled as an assumption:
  - for a target with major ≥ 1: the latest published stable version below the target's major line (`B.major.0.0`), so a package that skipped a major still gets a default;
  - for a `0.y.z` target with y ≥ 1: the latest published stable version below `0.y.0`;
  - for a `0.0.z` target, or when no stable version exists below that bound: no default; the outcome is "needs clarification".

  When the package or the target cannot be resolved unambiguously, the outcome MUST be "needs clarification".
- **FR-005**: Every answer MUST report both the requested and the resolved versions.

**Sources and evidence**
- **FR-006**: Sources MUST be consulted in this priority: registry metadata, published release notes, the changelog file, then a comparison of release tags as a last resort.
- **FR-007**: Before any source is used, the miner MUST confirm that the repository belongs to the requested package and that the material corresponds to the requested version. This covers monorepos, package-prefixed tags and shared release notes.
- **FR-008**: Each source used MUST be recorded with its type, link, retrieval time, the version range it applies to, a content fingerprint and its trust level (official release material or repository evidence).
- **FR-009**: Release dates, version lists and repository locations MUST come from the registry. Source links MUST come from retrieved material. None of them may be generated or inferred.
- **FR-010**: Each change item MUST carry an evidence type:
  - *documented*: release notes or changelog state it;
  - *repository evidence*: a tag comparison shows it;
  - *inferred*: a possible concern derived from the evidence.

  Documented and repository-evidence items MUST include a verbatim supporting excerpt. Inferred items MUST name the evidence they are inferred from. The types MUST NOT be merged into one undifferentiated list.
- **FR-010a**: Each migration step MUST carry its own evidence status, separately from the change it belongs to:
  - *documented*: release notes, the changelog or an official migration guide state the step, and the step's own verbatim excerpt is recorded;
  - *inferred*: derived from repository evidence or from the documented change, with the evidence it relies on named;
  - *manual review*: no defensible replacement is known; the answer says manual review is needed instead of suggesting one.

  A model-written step without evidence MUST NOT be presented as documented.
- **FR-011**: The miner MUST NOT report a breaking change only because the major version number changed.
- **FR-012**: For jumps across several releases the miner MUST consider every relevant published release between A and B, including minor releases and 0.x releases. Adjacent releases with no changes may be grouped.

**Answer**
- **FR-013**: Every answer MUST open with a short plain-language summary that a buyer can use even if it ignores the structured parts.
- **FR-014**: Every answer MUST carry exactly one outcome: found, not found, needs clarification, out of scope or temporarily unavailable.
- **FR-015**: Every "found" answer MUST state whether coverage is complete or partial and list the releases covered and not covered.
- **FR-016**: Every answer MUST include a security section built from two sources:
  - security fixes documented between A and B, extracted as change items of kind *security fix*, with any CVE/GHSA identifiers the evidence names;
  - advisories in the OSV database affecting A or B, each with identifier, aliases, severity as OSV reports it, its complete affected ranges and listed versions, whether A and B are affected, decided from all of that data, and the resulting conclusion.

  The section MUST state whether the advisory check was complete, partial or unavailable, and when it ran. An empty advisory list MUST NOT be presented as "no known advisories" unless the check was complete. The section MUST follow the correlation rules in User Story 4 and MUST NOT claim a security improvement without evidence. It is part of the migration answer only. Standalone vulnerability scanning and registration for a security intent are out of scope for this feature; a separate security intent is an optional later step.
- **FR-017**: The miner MUST keep a structured internal result and render it into exactly the form the registered Telegraph intent accepts. A real request and response through Telegraph MUST be captured and documented before the rendering is finalized.

**Consistency and reproducibility**
- **FR-018**: Identical normalized requests MUST return identical answers while the sources and the processing version are unchanged. Answers MUST be recomputed when a source changes or the processing version changes.
- **FR-019**: The miner MUST keep a persistent snapshot of every source document an answer consulted (for the registry, the fields it used), with its content fingerprint, for at least the hackathon evaluation period. A cached answer MUST NOT outlive a change in any consulted source, advisory data included. A fingerprint alone is not enough: it proves identity but cannot reproduce the text.

**Safety and budgets**
- **FR-020**: Retrieved text MUST be treated as data, never instructions. The miner MUST NOT run commands or scripts taken from it, run package code, download or execute package archives, or let retrieved content change what it fetches. It MUST NOT invent links or change the requested package.
- **FR-021**: Fetching MUST be limited to approved hosts: the npm registry, GitHub and GitHub's raw-content host on validated repository paths, and the OSV API on its query path only. Every redirect and every name resolution MUST be revalidated, and the connection MUST go to the address that was validated. Local, private, link-local and cloud-metadata addresses, non-web protocols and unexpected ports MUST always be refused.
- **FR-022**: Each request MUST stay within fixed budgets: response size per source, number of source requests, overall time, redirects, comparison size, number of intermediate releases processed, and, across the whole request, the number of language-model calls, total model input and output size and total model cost. A long version jump MUST NOT turn into one model call per release. When a budget cuts coverage short, the answer MUST say so and name the releases not covered.
- **FR-022a**: The miner MUST serve only requests that carry Telegraph's credential and refuse all others before doing any work. It MUST also limit its own request rate and the number of concurrent first-time requests, and concurrent identical first-time requests MUST share one computation.

**Network participation**
- **FR-023**: The miner MUST be registered on the canonical question-answering intent read from the live Telegraph catalogue at registration time (`QUESTION_ANSWERING_GENERAL`, class judgment, on 2 Nov 2026). Being registered, purchasable, eligible for automatic routing, and scored and ranked MUST be tracked as separate states.
- **FR-024**: The miner MUST be publicly reachable, MUST expose a health check, and MUST record structured operational metrics.
- **FR-025**: A delivered "not found", "needs clarification" or "out of scope" answer is a valid paid answer. "Temporarily unavailable" is a delivery failure: it MUST be declared to Telegraph as a failure so the buyer is not charged. Both MUST be distinguishable in the miner's own records and in payment accounting.
- **FR-026**: Payments MUST go to a payout wallet separate from the PR bot's wallet. Common team ownership MUST be disclosed in the submission. Purchases by the team's own bot MUST NOT be presented as independent demand.

**Economics and evidence**
- **FR-027**: The miner MUST measure, separately for repeat (cached) and first-time requests:
  - latency, split into resolution, retrieval, language-model processing and the full Telegraph round trip;
  - upstream request count and cost per answer.

  It MUST also record payments without equating the buyer's price with the miner's income: the quoted price, the settled price, the protocol's share, the provider's accrued share, any refunded or uncharged failures, and the actual payout as settled, which may only be known per settlement batch rather than per call. The split and the payout currency are read from receipts and the live docs, not assumed.
- **FR-028**: For the Miners-track submission the team MUST keep the registration record, the payout wallet address, five complete sample requests and answers, the network acceptance test results and the measured latency and cost.

### Key Entities

- **Question**: the buyer's free-form text.
- **Normalized request**: ecosystem, package, requested "from" and "to" versions, and their resolved versions.
- **Release source**: one piece of retrieved material (registry record, release note, changelog section, tag comparison) with type, link, retrieval time, applicable version range, content fingerprint and trust level.
- **Change item**: kind (breaking, deprecation or security fix), any CVE/GHSA identifiers, the version it applies to, evidence type (documented, repository evidence or inferred), migration step, supporting excerpt and the source it came from.
- **Advisory**: identifier, aliases, severity entries, complete affected ranges and versions, whether the target is still affected, and source. The security section also carries the check's status and time.
- **Coverage**: complete or partial; releases covered, releases not covered, and why.
- **Answer**: summary, outcome, normalized request, target release date, change items, advisories, coverage, the sources consulted and the processing version.

## Success Criteria *(mandatory)*

### Measurable Outcomes

The benchmark is a set of 30 real npm transitions with reviewed expected breaking changes. One model drafts the expected changes from the release material, at least two other models check each case against the sources, every quote is checked word for word against its cited page, and a person settles the points the reviews disagree on. The set spans different packages and release-note styles, including monorepos, scoped packages, sparse changelogs and at least five multi-release jumps; it must not be many versions of one package. A separate negative set has 10 or more cases: nonexistent versions, missing release notes, unresolved tags and a simulated upstream outage.

- **SC-001**: At least 90% of documented change items have a verbatim excerpt that is present in the cited source, belongs to the right version and supports the stated change and migration step.
- **SC-002**: At least 80% of the reviewed breaking changes appear in the answer (recall).
- **SC-003**: Zero invented release dates, versions or source links.
- **SC-004**: Every negative case gets the correct outcome, and none suggests the upgrade is safe.
- **SC-005**: Every partial multi-release answer names all uncovered releases.
- **SC-006**: Repeat requests return identical content, with 95th-percentile latency under 0.5 seconds. First-time latency is published as median and 95th percentile, with a target under 2 seconds where the live intent requires it.
- **SC-007**: At least 99% of measured health checks succeed. Outages and any routing suspensions are recorded with their cause.
- **SC-008**: Security tests show no private-network requests, no package execution and no successful instruction injection from release text.
- **SC-009**: At least one purchase by an agent the team does not control, with receipt, signal and settlement evidence, before 1 Dec 2026.
- **SC-010**: At least one PR-bot migration whose patch materially uses this miner's answer, with the repository's tests passing.
- **SC-011**: Cost per first-time and per repeat answer is measured and reported against the Telegraph payout per answer.
- **SC-012**: On the benchmark, every security conclusion matches the User Story 4 correlation table, and no answer claims a security improvement without evidence.

## Assumptions

- Buyers send plain-text questions. On 2 Nov 2026 the question-answering intent had no structured input or output format, so the answer must make sense as text alone. The rendered form follows FR-017.
- The PR bot always sends explicit "from" and "to" versions, because it knows the installed version. The "from" default in FR-004 exists for other agents.
- Public release material is enough for most popular packages. Packages without it get "not found".
- A language model may be used to extract and explain changes from retrieved material, never to supply versions, dates, links or package identity.
- The hackathon spends no real money. Hosting and storage run on free tiers. Language-model extraction is bought on the Telegraph network from an LLM miner and paid in test USDC, so the miner is itself a buyer. The starting price is the network's usual floor (0.01 test USDC on 3 Nov 2026), which covers one model call per first-time answer; repeat answers come from the cache and cost nothing.
- Ranking on the general question-answering intent is possible but not guaranteed. On 2 Nov its evaluation pool had 3 of the 5 contributors it needs; on 3 Nov one provider (`qa-crossref`) nevertheless had a score and rank on it for epoch 2001, so scoring is running. Its test questions are general, so a high score is not expected. Score and rank are recorded, not assumed (FR-023). The team separately contributes package-release evaluation questions (Evaluators track 03); judgment intents are scored with evaluation questions, not a truth source. The active scorer is re-checked at registration.
- Purchases by the team's own PR bot are disclosed and are not counted as independent demand.

## Out of Scope

- PyPI and other ecosystems (follow-up).
- Standalone vulnerability scanning, or registration on a security intent (optional later step).
- General knowledge questions and generic software questions unrelated to a package version change.
- Arbitrary code analysis, writing or applying patches (the PR bot's job).
- Building an evaluation adapter (scoring module).
- Optimizing for ranking beyond the network acceptance test.
