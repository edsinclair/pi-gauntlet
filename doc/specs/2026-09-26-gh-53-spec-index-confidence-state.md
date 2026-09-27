# Spec index: confidence cutoff, dead-spec demotion, second predecessor pass

> **Superseded by:** [doc/specs/2026-09-26-gh-54-docs-corpus-index.md](./2026-09-26-gh-54-docs-corpus-index.md) - Component 1 Query steps 1, 3, 4, 5, 6-7 (table name, strong fields, weights and state-aware sort become corpus-descriptor driven) and the Scope-limit sentence "the bin reads no overrides file" only

**Ticket:** jjuraszek/pi-gauntlet#53
**Goal:** Make `bin/gauntlet-spec-index.mjs` return only rows that are real predecessor evidence - fewer than `--limit`, down to zero - label fully superseded specs `superseded` and sort them after live rows, and re-run the predecessor query at spec-writing from the finished spec's own title, goal, and headings.

## Problem

The scout's predecessor check runs one FTS5 query composed from the request (a 10-word ticket title when the request is only a ticket ref) and takes the top `--limit` rows as candidates. The bin ORs every token and applies `LIMIT` inside SQL, so a query with no predecessor still fills ten rows with noise (`config service` on the consumer corpus: ten rows between -0.82 and -0.77), and a query with one real predecessor drags nine irrelevant rows behind it. A fully superseded spec scores as well as its successor and carries telemetry `status: shipped`, so nothing in the row tells the scout it is dead. Terms the eventual spec uses (its title, goal, H2s) are unknown when the first query runs, so predecessors phrased differently from the ticket are never found, and nobody re-queries.

Replaying 13 real predecessor queries from pi session history against gridstrong (578 specs) and this repo (91 specs) confirmed the shape: a ratio-to-best cut alone keeps noise when there is no strong row; an evidence-count cut alone (>= 2 matched rare tokens anywhere) still leaves 4-16 rows on queries that have no predecessor, because on real corpora almost every token is rarer than half the corpus. What separates predecessors from tail is where the tokens hit: predecessors match the query in `title`/`goal`.

The index is a supportive source only. Code is what runs; specs may be absent from or under-represented in the index, so no step in this design treats an index miss as proof that no predecessor exists.

## Acceptance criteria

Ticket jjuraszek/pi-gauntlet#53, `Acceptance criteria`, rows verbatim:

- [ ] A confidence rule is implemented in `bin/gauntlet-spec-index.mjs`'s query path as one shared function applied to every FTS table the bin queries. On a fixture corpus of six specs where one spec matches three query terms in title and goal and five specs each match one common query term in body only, `--query '<those terms>' --limit 10` returns exactly the one strong row. A query with no matching terms returns zero rows, exit 0.
  in-scope
- [ ] The TSV header gains a `state` column after `shipped_at`: `superseded` when any `> **Superseded by:**` banner line below the spec's title ends in `- fully`; `live` otherwise, including partial supersession (the scout still follows the banner for the superseded sections). Superseded rows sort after every live row that survives the confidence rule, then by score; the rule's reference score (if it uses one) is computed over live rows. Fixture: a `superseded` spec with a better raw score than a `live` spec is emitted after it.
  in-scope (reading: "below the spec's title" means the banner block directly under the H1, see Design)
- [ ] `skills/brainstorming/SKILL.md` spec self-review runs `gauntlet-spec-index` a second time with a query composed from the finished spec's title, `**Goal:**` line, and H2 headings; the user review gate summary lists each `live` candidate not already named in the draft's `Predecessor:` line, or states that none were found. `gatherer.md`'s scout query composition is unchanged.
  deviates: the scout query composition changes by one phrase - "from the ticket title" becomes "from the ticket title and body" - because a ticket-ref-only request otherwise never puts the ticket body's terms in front of FTS in the first pass; the scout already has the tracker CLI. The second pass, the gate line, and the `live`-only listing ship as written (Design, components 2-3).
- [ ] README's "Spec search index" section documents the `state` column, the sort order, and the confidence rule; `npm test` passes with the fixtures above added to the existing bin test file.
  in-scope

## Design

Supersedes `doc/specs/2026-09-17-gh-34-spec-search-index.md`, Design steps 5 (banners indexed as text only), 6 (`ORDER BY score LIMIT ?`), 8 (eight-column output) and Testing items 2, 7, 8 only; every other gh-34 clause stays live. `doc/specs/2026-09-24-gh-52-scout-predecessor-anchors.md` (the `files` column and anchors) is extended, not replaced, and gets no banner. `files` stays output-only and is never a ranking or selection input.

### Component 1 - `bin/gauntlet-spec-index.mjs`

All changes stay in this one file; no new modules.

**Constants.** Next to `SCHEMA_VERSION` (bumped `1` -> `2`, so existing caches rebuild on first run):

| Constant | Value | Meaning |
|---|---|---|
| `EVIDENCE_DF_FRACTION` | `0.5` | a token with `df >= N * 0.5` is not evidence (mirrors bm25's own idf clamp) |
| `MIN_EVIDENCE_TOKENS` | `2` | distinct evidence terms a row needs overall, and in `title`/`goal`; a query with fewer than two distinct evidence terms returns zero rows |
| `SCORE_RATIO` | `0.5` | a row survives only with `|score| >= SCORE_RATIO * |best live score|` |
| `FULLY_BANNER` | regex for `> **Superseded by:** [...](...) - fully` | the default banner grammar of `skills/brainstorming/reference/superseding.md` |

**Extraction.** `extract(text, path)` gains `state`. The title block is every line after the first `# ` line up to the first `## ` heading or code fence. `state = "superseded"` when any line in that block matches `FULLY_BANNER` (a `> **Superseded by:**` line ending literally in `- fully`); otherwise `live`. Free-form lines between the H1 and the banner do not stop the scan. Banners under an H2, inside a code fence, with a named-section scope, or ending `- fully; ...` leave the spec `live`. The FTS table gains `state UNINDEXED` appended after `body`; the `bm25()` call gains a trailing `0` weight and the `snippet()` column index stays 5.

**CLI.** New optional flag `--exclude <repo-relative path>` (repeatable): rows with that `path` are removed before the confidence filter, so an excluded document never sets the reference score. The second pass uses it for the spec under review.

**Query.** `LIMIT` leaves the SQL. `toMatch` splits into `tokens(query)` and the OR-joiner; `tokens` splits the query on unicode61 word boundaries (any run of characters that are not letters, digits, or private-use code points - the same token characters unicode61 keeps) and drops pieces shorter than two characters, so one token is one indexed word and a hyphenated compound such as `gauntlet-spec-index` never reaches `MATCH` as an adjacency phrase; the inline SQL in `main()` moves into `query(db, tokens, { limit, exclude })`, which runs, in order:

1. `N = count(*) FROM specs`.
2. Group tokens by indexed term: insert each sanitised token as its own row into an in-memory `fts5(tokenize='porter unicode61')` table and read its `fts5vocab(..., 'instance')` rows, so `index`/`indexing`/`INDEX` collapse to one term `index` and `configuration`/`configure` to `configur`. Each distinct term keeps one representative token - the first token that produced it - and only representative tokens are sent to `MATCH` from here on (a stemmed term is never used as a query string: FTS5 stems query text again, and porter is not idempotent - `manatee` indexes as `manate`, and `MATCH "manate"` re-stems to `manat` and misses it).
3. Per term, with its representative token `<tok>`: `MATCH "<tok>"` -> rowid set and `df`; `MATCH title:"<tok>" OR goal:"<tok>"` -> title/goal rowid set. Evidence term: `0 < df < N * EVIDENCE_DF_FRACTION`. Fewer than `MIN_EVIDENCE_TOKENS` evidence terms -> zero rows, stop.
4. Candidate rows: the existing weighted-bm25 OR query over the distinct representative tokens, no `LIMIT`; drop rows whose `path` is in `exclude`.
5. `confidenceFilter(rows, evidence)` - the one shared function the AC names, applied to every table queried (one today). A row survives when it matches `>= MIN_EVIDENCE_TOKENS` distinct evidence terms overall and `>= MIN_EVIDENCE_TOKENS` of them in `title`/`goal`.
6. Sort survivors `live` first, then ascending bm25 score (more negative = better).
7. `best = |score|` of the first live survivor. Drop every row, either state, with `|score| < SCORE_RATIO * best`. With no live survivor, skip this step; superseded survivors are emitted in score order.
8. Slice to `--limit`.

Zero rows prints the header only, exit 0 (existing behaviour). An empty sanitised query still calls `usage()` and exits 1 (existing behaviour, distinct from a valid no-hit query).

**Output.** `HEADER` becomes `score, path, service, title, status, shipped_at, state, files, snippet`. `files` and `snippet` shift one position; their meaning is unchanged.

**Scope limit.** Only the default banner grammar is recognised. A consumer that overrides the banner syntax in its overrides file gets `live` for every row; the bin reads no overrides file.

### Component 2 - `skills/brainstorming/gatherer.md` scout template

Three phrase-level edits, imperative, per `/skill:writing-skills`:

- "take the terms from the ticket title via the tracker CLI" -> "take the terms from the ticket title and body via the tracker CLI".
- After the sentence explaining the `files` column, one sentence: the `state` column is `live` or `superseded`; cite a `superseded` row only through its successor.
- After "treat its rows as the candidate list", one sentence: zero rows means the index found no evidence, not that no predecessor exists; judge `Predecessor: none` from the code recon.

The existing banner-following sentence and the anchors contract are untouched.

### Component 3 - `skills/brainstorming/SKILL.md` Spec Self-Review

Insert one step between the current step 3 (line-1 check) and step 4 (predecessor banner edit), renumbering the rest; the banner edit stays last so it cites the final path. Two dependent references update with it: Checklist item 7 "steps 1-4" -> "steps 1-5", and the banner step's opening "After the line-1 check and before the inline lint" -> "After the second predecessor pass and before the inline lint".

The step: compose a query from the spec's H1 terms, then the terms of every H2 that is not a template heading (Problem, Acceptance criteria, Design, Errors and edge cases, Tests, Documentation impact, Out of scope, Open questions), then the `**Goal:**` line's terms, in that order, same token rules as the scout, deduplicated, cut at 15 terms. Run `(cd <abs worktree path> && node <SPEC_INDEX> --query '<terms>' --limit 5 --exclude <spec path relative to the worktree>)` (`<SPEC_INDEX>` resolved as in `gatherer.md`; the subshell form is the one the stage-skill lint allows). Take the `live` rows and drop every path already named in the draft's scout `Predecessor:` line(s), retained from the step-1 read. The remainder becomes one adjacent gate line:

```
New predecessor candidates at spec-writing: <path> (<title>), ... - index rows are a hint; code is the source and an absent row proves nothing.
```

or `New predecessor candidates at spec-writing: none.` A non-zero bin exit degrades to `Second predecessor pass unavailable: <first stderr line>`; it never blocks the gate or the commit. The user adjudicates at the gate; "yes, <path> is a predecessor" is a normal change request that adds the `supersedes <path>, <scope>` clause and the banner, then re-presents the gate.

The gate template gains the line in its adjacent-lines slot. Red Flags gains one bullet: gate reached without the second predecessor pass.

### Data flow

Scout -> `--query '<ticket title+body terms>'` -> bin (evidence filter, live-first sort, ratio, limit) -> scout reads `state`, follows successors -> `Predecessor:` lines. Spec written -> main loop -> `--query '<H1+H2+goal terms>' --limit 5` -> new live paths -> adjacent gate line -> user.

## Errors and edge cases

| Case | Behaviour |
|---|---|
| query with fewer than two distinct evidence terms (single token, repeated word, stem variants of one word) | zero rows, exit 0 |
| corpus of N <= 2 indexed specs | no term can satisfy `df < N/2`; every query returns zero rows (README states this; the scout clause covers it) |
| `--exclude` names a path not in the corpus | no effect |
| two live survivors with equal best score | both survive (`>=` is inclusive) |
| only superseded survivors | ratio skipped; superseded rows returned in score order |
| several banners in the title block, `- fully` not first | `superseded` (any `- fully` line in the block counts) |
| `- fully` inside a code fence or under an H2 | `live` |
| draft-marker spec | excluded from the index, as today |
| second pass finds a path the scout named | not new; no gate line entry |
| second pass and the spec under review | excluded via `--exclude` before the filter, so its own score never sets the ratio bar |
| H1 + H2 + goal terms exceed 15 | truncate in that order (goal terms dropped first, then H2 terms) |
| v1 cache on disk | rebuilt silently on first query |
| no FTS5 module / empty sanitised query | existing errors, unchanged |

## Tests

Extend `bin/gauntlet-spec-index.test.mjs` in its existing scratch-repo, `spawnSync` style. The existing suite needs migration, not just a column shift: the shared `repo()` fixture indexes two specs and every query is single-token, so under the new rule every existing query returns zero rows. Grow `repo()` to a corpus where the probe tokens are evidence (df below N/2) and rewrite each query as two rare terms hitting `title`/`goal`; keep the orthogonal assertions (discovery, refresh, telemetry, framing, sanitising); delete gh-34 test 2's "default returns up to 10"; move `schema_version` assertions to `2`; positional assertions move to the nine-column header; replace gh-34 test 8/9 (banner as plain text, no status column) with the `state` tests below.

1. AC1 fixture: six specs, one strong (three query terms in title+goal), five body-only common-term rows; `--limit 10` returns exactly the strong row.
2. No-match query (terms in no spec): zero rows, header printed, exit 0. All-common two-word query on the AC1 fixture: same.
3. Evidence identity: `configuration configuration`, `Configuration configure`, and `index indexing` each count as one evidence term and return zero rows on a corpus where the single term alone would qualify.
4. Ratio: a title-matching second row at roughly a third of the best score is dropped; an equal-score pair is both kept.
5. `state`: `- fully` under the H1 -> `superseded`; `- fully` after an intervening free-form `>` line -> `superseded`; named-section banner -> `live`; `- fully; ...` -> `live`; `- fully` inside a fenced block -> `live`; column sits after `shipped_at`.
6. Ordering: a `superseded` row with a better raw score is emitted after a `live` row; `--limit 1` returns the live one.
7. Ratio ignores superseded: a superseded row with the best raw score does not raise the bar for live rows.
8. `--exclude`: a document scoring more than twice a qualifying predecessor is excluded and the predecessor is returned; without `--exclude` it is not.
9. `npm test` skill lint passes for the edited `gatherer.md` and `SKILL.md`.

Real-corpus replay evidence behind the constants (not a CI test): on gridstrong and this repo the rule returns the exact true set on every known-predecessor query (excavation-visibility 2, parked-points 1, this brainstorm's query -> gh-34 and gh-52) and zero rows on six of seven no-predecessor queries.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `README.md#spec-search-index` (nine-column header, `state` semantics and custom-banner caveat, live-first sort, confidence rule in two sentences, `--exclude`, the N <= 2 caveat, second pass at spec-writing); `CHANGELOG.md` `## Unreleased`
- Derived / memory docs invalidated: none (the `AGENTS.md` routing row already points at the README section)

Per `reference/documentation-impact.md`, the `gatherer.md` and `SKILL.md` edits are implementation surface, not doc-impact entries.

## Out of scope

Custom banner syntaxes in the bin; any overrides-file read in the bin; changes to the scout's `Predecessor anchors` section; re-dispatching the scout at spec-writing; telemetry-derived currency signals; corpus-specific stopword lists; indexing non-spec documents.
