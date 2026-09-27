# Spec index: project documentation as a second corpus

**Ticket:** jjuraszek/pi-gauntlet#54
**Goal:** Give `bin/gauntlet-spec-index.mjs` a `--corpus docs` mode that indexes a project's Markdown documentation (default: `doc/`, `docs/`, `README.md`, `AGENTS.md`; overridable per project) into a second FTS5 table in the same cache, ranks and filters it through the same corpus-agnostic confidence rule the specs corpus uses, and gives the brainstorming scout a fixed `Docs touched:` line so `## Documentation impact` starts from evidence instead of memory.

## Problem

The scout's "does the codebase or ecosystem already solve this?" question and brainstorming's `## Documentation impact` section both depend on knowing which project documents already describe the topic under design. Today the scout answers from a directory walk and its own reading; the spec index covers `doc/specs/*.md` only. A consumer with many services carries most of its current contracts in `*/doc/**/*.md`, `README.md`, and `AGENTS.md`, none of which the index sees, so overlapping docs are found late (at the finish gate's doc-impact check) or not at all.

The confidence rule shipped for #53 is written as "one shared function applied to every FTS table the bin queries", but its implementation hard-codes the `specs` table, the `title: OR goal:` strong-field predicate, the bm25 weight vector, and the `state` sort. A docs row has no `**Goal:**` and no supersession state, so the rule cannot be applied to a second table without first becoming corpus-agnostic in fact, not only in intent.

## Acceptance criteria

Ticket jjuraszek/pi-gauntlet#54, `Acceptance criteria`, rows verbatim:

- [ ] `gauntlet-spec-index.mjs --corpus docs --query '<text>'` returns TSV rows with header `score`, `path`, `title`, `snippet` from `**/*.md` under the worktree root, excluding paths matching `**/doc/specs/**`, `**/node_modules/**`, `.pi/gauntlet/**`, `.worktrees/**`, and any file whose first line is exactly `# CONTEXT DRAFT - NOT A SPEC - fully replaced at spec-writing`; fixture covers one file per exclusion.
  deviates: the candidate set is not `**/*.md` but an include list - default `**/doc/**/*.md`, `**/docs/**/*.md`, `README.md`, `AGENTS.md` (root and one service level down), replaceable per project through the gauntlet overrides file - because on a multi-service consumer `**/*.md` outside specs is dominated by skill and prompt bodies and infrastructure-module READMEs, not project documentation. The header, the five listed exclusions, and the one-fixture-per-exclusion test ship as written (Design, component 2 and Tests); the fixed exclusion list additionally covers `**/docs/specs/**`, `**/doc/plans/**`, `**/docs/plans/**`, and gitignored paths.
- [ ] `--corpus specs` and omitted `--corpus` produce identical output at the same commit; no `docs` row ever appears in a specs query and no telemetry-derived column (`status`, `shipped_at`, `files`, `state`) appears in a docs query.
  in-scope
- [ ] Both tables live in the same `.pi/gauntlet/index.sqlite` with independent mtime+size caching, and the docs query goes through the same shared confidence function as the specs query (fixture: one strong docs match plus five single-common-word matches returns one row).
  in-scope
- [ ] `gatherer.md`'s scout template adds one `--corpus docs` query whose rows feed the "already solves this?" finding and a `Docs touched:` list that the spec's `## Documentation impact` section draws from; the predecessor check remains `--corpus specs`. README's "Spec search index" section documents `--corpus`.
  in-scope (reading: `Docs touched:` is a fixed-grammar line rendered after the `Predecessor:` line(s), at most five entries, each opened and judged by topic; it supplements the scout's own orientation and never replaces it - see Design, component 3)
- [ ] `npm test` passes with the fixtures above.
  in-scope

## Design

Supersedes `doc/specs/2026-09-17-gh-34-spec-search-index.md`, Design per-invocation steps 3-5 (corpus discovery, schema, incremental refresh) only - each is generalised over a corpus descriptor; the specs corpus keeps every value gh-34 chose. Supersedes `doc/specs/2026-09-26-gh-53-spec-index-confidence-state.md`, Component 1 "Query" steps 1 and 4 (the `specs` table name and the weight vector become descriptor reads), step 3 (the `title:/goal:` literal), step 5 (`title`/`goal` as the strong fields), steps 6-7 (state-aware sort and reference score, now conditional on the corpus), and the "Scope limit" paragraph's sentence "the bin reads no overrides file" only. Every other gh-53 clause - `state` extraction, `--exclude`, the second predecessor pass - stays live and authoritative.

**The shared confidence rule, as it applies to every corpus** (values from gh-53, restated so this spec is complete on its own): tokens are grouped into indexed terms through an in-memory porter FTS table so `index`/`indexing` are one term; a term is *evidence* when `0 < df < N * EVIDENCE_DF_FRACTION` (`0.5`) with `N = count(*)` of the queried table; fewer than `MIN_EVIDENCE_TOKENS` (`2`) evidence terms in the query returns zero rows; `--exclude` paths are dropped before anything else; a row survives `confidenceFilter` when it matches >= 2 distinct evidence terms overall and >= 2 in the corpus's `strong` fields; the reference score for `SCORE_RATIO` (`0.5`) is the best surviving live row (every row is live when the corpus has no `state`); a row with `|score| < 0.5 * best` is dropped; then `--limit`. Consequence: a corpus of two or fewer documents never returns rows, in either corpus.

### Component 1 - corpus descriptors in `bin/gauntlet-spec-index.mjs`

All bin changes stay in this one file; no new modules, no new dependency.

A `CORPORA` map keyed by the `--corpus` value holds one descriptor per table:

| field | `specs` | `docs` |
|---|---|---|
| `table` | `specs` | `docs` |
| FTS columns | `path U, service U, title, goal, headings, body, state U` | `path U, title, headings, body` |
| `strong` (fields for the strong-evidence test) | `title`, `goal` | `title`, `headings` |
| bm25 weights (per column, in FTS column order) | `0, 0, 10, 5, 2, 1, 0` | `0, 10, 3, 1` |
| snippet | `body` (index 5) | `headings` (index 2) when it holds a query term, else `body` (index 3) |
| `hasState` | `true` | `false` |
| TSV header | `score, path, service, title, status, shipped_at, state, files, snippet` (unchanged) | `score, path, title, snippet` |
| discovery | `discover(root)` (unchanged) | `discoverDocs(root, includes)` |

(`U` = `UNINDEXED`.) `refresh(db, root, corpus)`, `query(db, corpus, tokens, { limit, exclude })`, `confidenceFilter(rows, evidence, corpus)`, and the TSV writer take the descriptor; every place that today spells `specs`, `title:"<tok>" OR goal:"<tok>"`, `bm25(specs, 0,0,10,5,2,1,0)`, or `snippet(specs, 5, ...)` reads the descriptor instead. The strong-field predicate is `descriptor.strong.map(f => f + ':"<tok>"').join(" OR ")`. When `hasState` is `false`, every survivor is treated as live: the sort is by score alone and the reference score for `SCORE_RATIO` is the best survivor. The telemetry join runs only for `hasState` corpora; a docs row never reads telemetry.

The `files` freshness table gains a `corpus TEXT NOT NULL` column and its primary key becomes `(corpus, path)`, so a path present in both corpora (impossible by construction today, but cheap to make impossible by schema) can never confuse the delete pass. `refresh()` deletes rows for `(corpus, path)` pairs no longer returned by that corpus's discovery. `SCHEMA_VERSION` bumps `2` -> `3`; an existing cache rebuilds on first run, as today.

**Docs extraction.** `extractDoc(text, path)` uses the same rules as the specs extractor: `title` is the first `# ` line's text, else the filename stem; `headings` is every `##`/`###` heading text (the specs regex `/^##{1,2} /`) joined by newlines; `body` is the full file text. Lines inside fenced code blocks are skipped for `title` and `headings` in both extractors - a fenced `## Spec index` example must not become strong evidence. No `goal`, no `state`. Files whose first line equals `DRAFT_MARKER` are dropped at discovery, not extraction.

**Docs snippet.** The docs query selects two snippets per row inside the `MATCH` statement - `snippet(docs, 2, '\u0001', '\u0002', '', 12)` over `headings` and the existing marker-free 12-token snippet over `body`. When the headings snippet contains the `\u0001` marker, the emitted `snippet` is the single heading line (split on newline) that holds the first marked term, markers stripped; otherwise the body snippet is emitted. The `Docs touched:` line uses this as a hint to the covering section, not as authority (component 3).

**CLI.** New optional flag `--corpus specs|docs`, default `specs`. Any other value calls `usage()` and exits 1, the existing bad-flag path. `--query`, `--limit`, `--exclude` apply to whichever corpus is selected.

### Component 2 - docs discovery and the overrides key

`discoverDocs(root, includes)` runs `git -C <root> ls-files -co --exclude-standard -z -- '*.md'` (tracked plus untracked, gitignored excluded; the bin already requires git for `repoRoot()`), then keeps a path when all of these hold:

1. It matches at least one include glob (via `path.matchesGlob`, Node >= 22.5, within the bin's `MIN_NODE`). An include glob containing no `/` (default `README.md`, `AGENTS.md`, or an override such as `CONTRIBUTING.md`) also matches one service level down (`<service>/README.md`); `<service>` is any top-level directory `discover()` would scan - not a dot directory, not in `SKIP_DIRS`. `**` never matches a dot-directory segment, so `.github/*.md` or `.pi/*.md` is indexed only through an explicit override include naming the dot directory.
2. It matches none of the fixed exclusions: `**/doc/specs/**`, `**/docs/specs/**`, `**/doc/plans/**`, `**/docs/plans/**`, `**/node_modules/**`, `.pi/gauntlet/**`, `.worktrees/**`.
3. `lstatSync` succeeds and reports a regular file (a tracked file deleted but not yet staged, a dangling link, and any symlink are skipped - a symlink could otherwise smuggle an excluded spec or an out-of-worktree file in through an eligible path).
4. Its first line is not `DRAFT_MARKER`.

A skipped path is absent from discovery, so its cached rows are deleted at refresh like any removed file. `git ls-files` does not descend into nested repositories or submodules; docs inside them are not indexed (the specs corpus, which walks the filesystem, still finds their `doc/specs`). This single-repository limit is stated in README.

**Default include list:** `**/doc/**/*.md`, `**/docs/**/*.md`, `README.md`, `AGENTS.md`.

**Override contract.** The bin resolves the gauntlet overrides file in the standard order - `.pi/gauntlet-overrides.md`, `gauntlet-overrides.md`, `doc/gauntlet-overrides.md` under the worktree root, first found wins - and reads one section:

```markdown
## Spec index
- docs: `**/doc/**/*.md`
- docs: `handbook/**/*.md`
```

Every `- docs: <glob>` bullet between that heading and the next `## ` heading contributes one include glob (surrounding backticks or quotes stripped). A non-empty list replaces the default include list; no section, or a section with no `docs:` bullets, means the default. The fixed exclusion list is never read from the file and always applies on top, so a project cannot re-include specs, plans, drafts, or the cache. No other key under `## Spec index` is read. The bin never reads any other section. The overrides file itself follows the same rules as any other Markdown: `doc/gauntlet-overrides.md` matches the default include and is indexed; `.pi/gauntlet-overrides.md` is indexed only through an explicit `.pi/*.md` include.

### Component 3 - `skills/brainstorming/gatherer.md` scout template

Add one passage to the scout task template directly after the anchors contract and before "End with an Open questions section", imperative, per `/skill:writing-skills`:

> Docs check: run `node <SPEC_INDEX> --corpus docs --query '<the same keywords>' --limit 10` from the worktree root. Its rows are project documentation that already speaks about the request's topic; open at most five whose topic matches and let them inform the "already solves this?" finding and the current-contract recon. If the command fails, write `Docs index unavailable - docs check used recon only.` in your handoff and continue. After the `Predecessor:` line(s) and any `Predecessor anchors` section, render one `Docs touched: <path> - <section heading>` line per document that genuinely covers the request's topic - an opened index row or a document your own recon found - where `<section heading>` is the `##`/`###` heading of the covering section as read in the document (the row's `snippet` column is a hint to it), or the document title when no single section applies; or `Docs touched: none`. Judge by topic; a lexical hit alone is not coverage. Zero rows means the index found no evidence, not that no document covers the topic. This query supplements the code and documentation recon you already perform; it never replaces it - keep reading the files the request touches.

The predecessor query stays `--corpus specs` (the default); its composition, the `Predecessor:` grammar, and the anchors contract are untouched. The gather draft carries `Docs touched:` inside `## Codebase recon` like every other scout line.

`skills/brainstorming/SKILL.md` gains one sentence in "6. Present the design in two rounds": round 2 cites the draft's `Docs touched:` entries as candidates for "Materially amended existing docs" in `## Documentation impact`; each candidate is admitted or dropped by the materiality bar in `reference/documentation-impact.md`, never listed automatically.

### Data flow

Scout -> `--query '<terms>'` (specs) -> `Predecessor:` lines, as today. Scout -> `--corpus docs --query '<terms>'` -> bin: `discoverDocs` -> `refresh(docs)` -> `query(docs)`: `N = count(*) FROM docs`; term grouping; per-term `MATCH` and `title:/headings:` strong sets; evidence terms (`0 < df < N * EVIDENCE_DF_FRACTION`); OR'd bm25 with docs weights plus both snippets; `confidenceFilter` (>= 2 evidence terms overall and in `title`/`headings`); score sort; `SCORE_RATIO` against the best survivor; `--limit` -> four-column TSV -> scout opens <= 5 by topic, adds recon-found docs -> `Docs touched:` lines -> gather draft -> brainstorming round 2 -> `## Documentation impact` candidates.

## Errors and edge cases

- Unknown `--corpus` value: `usage()`, exit 1.
- `git ls-files` failure: unreachable as a new mode - `repoRoot()` already dies when git or the repository is missing.
- Overrides file absent, or present without `## Spec index` or without `docs:` bullets: default include list, no message.
- Include list matching zero files, or a docs corpus of two or fewer files: header-only TSV, exit 0; the scout writes `Docs touched: none` or lists recon-found docs.
- A tracked file deleted but not staged, a dangling symlink, or any symlink: skipped at discovery (rule 3), its cached rows removed at refresh; the query never crashes on `ENOENT`.
- Nested repositories and submodules: their docs are not listed by `git ls-files` and are not indexed; README states the limit.
- A file with no `# ` heading: title is the filename stem, `headings` may be empty; the row can pass the strong test only through title terms.
- A file listed by two include globs, or by a slash-free include and its service-level form: one row; `(corpus, path)` is the key.
- Include list changed between runs: paths no longer discovered are deleted from `docs` and `files` at the next refresh because discovery is the delete pass's source of truth.
- A context draft outside `doc/specs/` (a `doc/notes/draft.md` with the marker on line 1) is excluded by the marker check.
- The `--corpus docs` command fails in the scout (old Node, missing FTS5): the scout writes `Docs index unavailable - docs check used recon only.` and still renders `Docs touched:` from its own recon.
- A superseded spec and a doc sharing a title: unrelated - the corpora are separate tables with separate df statistics, and no query spans both.
- Consumers with an overridden supersession-banner syntax: unaffected; docs rows have no `state`.

## Tests

All in `bin/gauntlet-spec-index.test.mjs`, using the existing temp-git-repo fixtures and subprocess launch:

1. **Specs output unchanged.** On the existing specs fixture, `--query` with and without `--corpus specs` produce byte-identical TSV; the header is the nine gh-53 columns (AC2).
2. **Docs corpus and exclusions.** Fixture: `doc/guide.md` (H2 containing two query terms), `README.md` (one query term in body), four filler docs `doc/filler-{1..4}.md` with no query terms (N = 6, so the probe terms stay below N/2 - the same device the specs fixture uses), and one otherwise-eligible file per fixed exclusion: `doc/specs/a.md`, `docs/specs/b.md`, `doc/plans/p.md`, `docs/plans/q.md`, `node_modules/x/doc/a.md`, gitignored `build/doc/b.md`, and `doc/draft.md` with `DRAFT_MARKER` on line 1; `.pi/gauntlet/n.md` and `.worktrees/w/doc/g.md` are exercised under an override that includes `.pi/**/*.md` and `.worktrees/**/*.md`, since `**` never matches a dot directory under the default. `--corpus docs --query` emits the header `score	path	title	snippet` and exactly `doc/guide.md`; none of the excluded paths appears in the `docs` table (AC1, one fixture per exclusion). A second fixture with two included docs asserts header-only output.
3. **Shared confidence rule on docs.** Fixture: one doc matching three query terms in `title`/`headings` plus five docs each matching one common query term in body only; `--corpus docs --query '<terms>' --limit 10` returns exactly the strong row (AC3).
4. **No cross-corpus leakage.** A specs query returns no `doc/guide.md`; a docs query header contains none of `status`, `shipped_at`, `files`, `state` (AC2).
5. **Independent caching, both directions.** Touch a spec file and run `--corpus docs`: the specs `files` row keeps its old `mtime_ms` and the `docs` rows are unchanged. Then run `--corpus specs`: the `docs` table and its `(docs, path)` freshness rows survive the specs delete pass (AC3).
6. **Override replaces the default.** `.pi/gauntlet-overrides.md` with `## Spec index` and `- docs: \`notes/**/*.md\``: `notes/a.md` is indexed, `doc/guide.md` is not; with `- docs: \`**/*.md\``, `doc/specs/a.md` and `doc/plans/p.md` are still absent; a slash-free override `- docs: \`CONTRIBUTING.md\`` also indexes `svc/CONTRIBUTING.md`.
7. **Descriptor strong fields (subprocess).** Two docs share the same two evidence terms, one in `headings`, one in `body` only, plus fillers; `--corpus docs` returns only the headings row.
8. **Snippet selection.** A docs row whose headings contain no query term gets a body snippet; a row whose headings do gets exactly the one heading line holding the first matched term, without markers.
9. **Skipped discovery entries.** Delete a tracked, indexed `doc/gone.md` without staging, add a dangling `doc/dangling.md` and a symlink `doc/link.md` -> `doc/specs/a.md`: the query succeeds, `doc/gone.md`'s rows are removed, neither link is indexed.
10. **Fenced pseudo-headings.** A doc whose only `## ` line sits inside a code fence has an empty `headings` field.
11. **Bad corpus.** `--corpus notes` exits 1 with usage on stderr.
12. **Schema rebuild.** A cache stamped `SCHEMA_VERSION` 2 is rebuilt to 3 with both tables present.

`npm test` runs these through the existing `scripts/ci.mjs` bin unit-test step; no new bin is added, so the packed-install smoke is unchanged.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `README.md#spec-search-index` (the `--corpus` flag, the default include list, the fixed exclusion list, the dot-directory and nested-repository limits, the corpus-agnostic phrasing of the confidence rule); README's overrides-file contract section (the `## Spec index` / `docs:` key, and its sentence "read by skill instructions, not by the Pi runtime itself" amended now that the bin reads one section); `CHANGELOG.md` `## Unreleased`
- Derived / memory docs invalidated: `AGENTS.md` routing row "Search the spec corpus" (now "Search the spec and docs corpora")

Materiality follows `reference/documentation-impact.md`; `skills/brainstorming/gatherer.md` and `skills/brainstorming/SKILL.md` are implementation surface and are not listed here.

## Out of scope

- Merging specs and docs rankings, or a single query spanning both tables.
- Indexing non-Markdown documentation (OpenAPI, code comments, generated API docs).
- A `state` column, supersession handling, or telemetry join for docs.
- Running the gh-53 second predecessor pass against the docs corpus.
- Reading any overrides key other than `## Spec index` -> `docs:`, or making the exclusion list configurable.
- Auto-populating `## Documentation impact` from `Docs touched:` rows.
- Stopword lists or per-project ranking tuning.
