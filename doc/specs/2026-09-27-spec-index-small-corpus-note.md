# Spec index: small-corpus note on header-only results

**Goal:** When `gauntlet-spec-index` returns no rows because the queried corpus is too small for the shared confidence rule to judge, say so on stderr, and have the brainstorming scout carry that reason into its `Predecessor: none` / `Docs touched: none` lines.

**Ticket:** none (post-release follow-up to jjuraszek/pi-gauntlet#54, found by the 5.23.0 sanity sweep).

**Predecessor:** supersedes `doc/specs/2026-09-26-gh-54-docs-corpus-index.md`, the `## Edge cases` small-corpus row only ("a docs corpus of two or fewer files: ... the scout writes `Docs touched: none`") - the scout now writes the parenthetical form below; every other section of that spec stands. `doc/specs/2026-09-26-gh-53-spec-index-confidence-state.md` owns the rule itself and is unchanged.

## Problem

`query()` in `bin/gauntlet-spec-index.mjs` treats a term as evidence only when its document frequency is below half the corpus size, and returns a row only when two distinct evidence terms hit the corpus's strong fields. On a corpus of a handful of documents almost every term occurs in half of them, so nearly every query returns the header only. A repository at the start of its life (five docs under the default include list; two or three specs) therefore gets the same output for "no document covers this" and "too few documents to judge" - header, exit 0, no rows - and the scout, which reads only the TSV, cannot tell them apart. `N <= 2` is the only mathematically guaranteed-empty case; at `N = 5` a query with two rare strong-field terms can still return rows, so a threshold above 2 is a policy choice and is stated as one.

## Acceptance criteria

none - no ticket

## Design

### Component 1 - the note in `bin/gauntlet-spec-index.mjs`

- Add `MIN_CORPUS = 10` beside `EVIDENCE_DF_FRACTION`, `MIN_EVIDENCE_TOKENS`, and `SCORE_RATIO`. It is the user-chosen policy threshold - a round floor below which the `df < N * 0.5` filter leaves too few evidence terms to trust an empty result - not the arithmetic minimum derived from the rule, and not configurable.
- `query(db, corpus, toks, { limit, exclude })` returns `{ rows, n }`, where `n` is the `SELECT count(*) FROM <table>` it already reads (the full table count, before `--exclude` removes rows). Both return sites change: the evidence-count early return (`evidence.length < MIN_EVIDENCE_TOKENS`) returns `{ rows: [], n }`, and the final `cut.slice(0, limit)` return becomes `{ rows: cut.slice(0, limit), n }`. Empty `--query` still exits through `usage()` in `main()` before `query()` runs.
- `main()` prints the header and rows exactly as today, then, when `rows.length === 0 && n < MIN_CORPUS`, writes one line to stderr:

  `gauntlet-spec-index: <corpus> corpus has <n> documents - too small for the confidence rule; no rows returned`

  `<corpus>` is the selected corpus name (`specs` or `docs`), `<n>` the count above. Exit code stays 0. stdout is byte-identical to 5.23.0 in every case.
- No note when rows are returned, whatever `n`; no note on a header-only result when `n >= MIN_CORPUS`. `n = 0` (empty corpus) gets the same note with `0 documents`; no special case.
- The second predecessor pass in `skills/brainstorming/SKILL.md` (`--exclude <spec path>`) runs the same `main()` and inherits the note unchanged; that passage is not edited.

### Component 2 - scout lines in `skills/brainstorming/gatherer.md`

The scout's bash tool returns stdout and stderr together, so the trigger is the diagnostic line in the command output, never a stream. In the scout task template, one sentence in each of the two index passages:

- Predecessor check, inserted directly after "judge `Predecessor: none` from the code recon.": `When the command output contains a line ending "too small for the confidence rule; no rows returned" (a diagnostic, not a row) and the code recon names no predecessor, write \`Predecessor: none (specs corpus too small: <n> documents)\`, copying <n> from that line.`
- Docs check, inserted directly after "Zero rows means the index found no evidence, not that no document covers the topic.": `When the docs command output contains that same diagnostic line and the recon found no covering document, write \`Docs touched: none (docs corpus too small: <n> documents)\` instead.` Recon-found documents still render as `Docs touched: <path> - <section heading>` lines as today.

Neither sentence weakens the existing "zero rows means the index found no evidence" clauses; both follow them. Both lines keep the `Predecessor: none` / `Docs touched: none` prefix, so the anchors rule (`Predecessor: none` produces no anchors section) and brainstorming's round-2 reading of `Docs touched:` are unaffected.

## Edge cases

- Small corpus, rows returned: no note; rows are the answer.
- Large corpus, header-only: no note; the existing "zero rows is not proof" guidance stands.
- `--exclude` removing rows from a corpus at the threshold: `n` is the table count before exclusion, so a 10-spec repo querying with its own spec excluded does not get the note (9 rows queried, 10 counted). Accepted: the note describes the corpus, not the candidate set.
- Command failure: the scout's existing `Spec index unavailable` / `Docs index unavailable` lines apply; the note is never written on a failing run because `main()` does not reach it.

## Out of scope

- Changing the confidence rule for small corpora (a floor, a relaxed strong-field requirement) - a separate change with data behind it.
- Making `MIN_CORPUS` configurable through settings or the overrides file.
- Any stdout change (footer, comment line, extra column).

## Tests

`bin/gauntlet-spec-index.test.mjs`, subprocess tests through the existing `run()` helper (which already captures `stderr`):

1. D2 two-document docs fixture: additionally asserts `stderr` contains `docs corpus has 2 documents - too small for the confidence rule; no rows returned`; status 0 and header-only unchanged.
2. Specs fixture with three spec files and a query matching none: `stderr` contains `specs corpus has 3 documents`; stdout is the nine-column header only; status 0.
3. Boundary: test 11's fixture (`strong.md` + `p1..p5`, N = 6) plus three fillers (N = 9): the header-only query `yeti unicorn` prints `specs corpus has 9 documents`; the same fixture plus a fourth filler (N = 10): `yeti unicorn` and `common shared` stay header-only with empty `stderr`, and `heron ibis jackal common` still returns only `doc/specs/strong.md`.
4. Count before exclusion: on the N = 10 fixture, `--query 'yeti unicorn' --exclude doc/specs/p1.md` is header-only with empty `stderr`.
5. Docs fixture with five documents where two rare terms sit in one document's headings: rows returned, `stderr` empty.
6. `scripts/ci.mjs` presence rows for `skills/brainstorming/gatherer.md`: `too small for the confidence rule; no rows returned`, `Predecessor: none (specs corpus too small:`, `Docs touched: none (docs corpus too small:`, so the bin's note text and the scout's trigger cannot drift apart silently.

Existing header-only tests on corpora under 10 (tests 12 and 16 at N = 7, D2 tiny) now print the note and are unaffected because they do not assert on `stderr`. `npm test` runs these through the existing bin unit-test and presence-check steps in `scripts/ci.mjs`.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `README.md#spec-search-index` (keep "a corpus of two or fewer files never returns rows" - still true - and extend the neighbouring "prints the header only and exits 0" sentence with: when the queried corpus has fewer than 10 documents, a one-line stderr note names the corpus and its size); `CHANGELOG.md` (new `## Unreleased` bullet)
- Derived / memory docs invalidated: none

Materiality per `reference/documentation-impact.md`; the `gatherer.md` edit is implementation surface, not a doc-impact entry.
