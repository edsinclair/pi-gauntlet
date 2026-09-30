# Spec directory discovery across telemetry, seal, and spec index

**Goal:** every consumer that classifies a path as a spec or plan - telemetry binding, the seal bin, the spec index, the phase guards - reads one resolved `flowGuards.specDirs` value, and that value's default covers both conventional layouts (`doc/specs`, `docs/specs`) so a repo needs no configuration to use either.

Supersedes `doc/specs/2026-09-25-gauntlet-bound-telemetry.md`, scope: spec/plan path classification (`isSpecPath`/`isPlanPath`), seal auto-selection, and the spec-index collect list. Binding lifecycle, record schema, and the ship dataset stay as that spec defines them.

## Problem

A repo that keeps specs in `docs/specs/` (observed in a consumer on pi-gauntlet 5.23.1, whose overrides prose says `Specs: docs/specs/`) hits four failures:

| Consumer | Literal | Effect |
|---|---|---|
| `extensions/lib/telemetry-paths.ts:19-20` `isSpecPath`/`isPlanPath` | `/(^|\/)doc\/specs\/[^/]+\.md$/`, `doc/plans` | A spec write under `docs/specs/` never binds a record; the record exists only because `plan_check` binds the plan's `**Spec:**` header without a path test (`extensions/telemetry.ts:519`) |
| `src/bins/gauntlet-telemetry-seal.mjs:124-140` | imports `isSpecPath` | `--spec docs/specs/x.md` exits 1 with usage; without `--spec`, auto-selection filters changed paths through the literal and prints `no telemetry run`; finishing cannot seal, "never land without the seal" blocks the PR |
| `bin/gauntlet-spec-index.mjs:99-100` | `doc/specs`, `<service>/doc/specs` | brainstorming's predecessor check reports `specs corpus has 0 documents` in a repo with a populated `docs/specs/` |
| `extensions/phase-tracker.ts` via `resolveFlowGuards` default `["doc/specs"]` | default only | brainstorm confinement warns on every `docs/specs` write; the marker commit scan never looks in `docs/specs` |
| `extensions/lib/telemetry-ship.ts:12` `modifiedFilesFrom` | `/(^|\/)doc\/plans\//` | `docs/plans/**` changes leak into the sealed record's `derived.modified_files` and diff buckets (called from `computeGitDiff`/`computeJjDiff` by both the seal and `telemetry.ts`) |
| `skills/gauntlet-resume/reference/reconstruction.md:29` | `default ["doc/specs"] (sibling doc/plans)` | a no-config `docs/specs` run is not discoverable by resume's candidate scan |

Repro (scratch git repo, in_progress record copied to `.pi/gauntlet/telemetry/docs/specs/x.yaml`): `gauntlet-telemetry-seal --worktree <wt> --option pr --base main --spec docs/specs/x.md` -> usage, exit 1. The same tree moved to `doc/specs/` -> `sealed .pi/gauntlet/telemetry/doc/specs/x.yaml`, exit 0. Adding `flowGuards.specDirs: ["docs/specs"]` to the repo's `.pi/settings.json` changes nothing today: only the phase guards read that key.

Corrected premises (accepted in the questionary): the consumer sets no `flowGuards.specDirs`; the overrides prose is not parsed by any code; the recorder does not honor the spec dir. Rejected alternatives: filesystem detection (brainstorming creates the dir on its first write, so the dir does not exist when the first classification runs); parsing the overrides prose (turns prose into config read in two places); a config-only fix (does not help a repo that set nothing).

## Acceptance criteria

none - no ticket

## Design

### 1. One resolver, one default

`resolveFlowGuards` in `extensions/lib/gauntlet-settings.ts` keeps its shape `{ enforce, specDirs }`. Its `specDirs` default changes from `["doc/specs"]` to `["doc/specs", "docs/specs"]`. A repo or preset `flowGuards.specDirs` that is a non-empty array of non-empty strings replaces the default entirely (existing behavior); `[]`, a non-array, or an array with an empty string falls back to the default (existing behavior, no new validation). Each entry is normalized before use: strip a leading `./` and any trailing `/`.

Plan dirs derive from spec dirs: for each spec dir, the sibling `plans` directory (`doc/specs` -> `doc/plans`, `design/specs` -> `design/plans`). A new `planDirsFor(specDirs): string[]` (plan dirs only, deduplicated) lives in `extensions/lib/gauntlet-settings.ts`, which imports nothing from `extensions/lib/` and is already imported by both `telemetry-paths.ts` and the phase tracker - `telemetry-paths.ts` imports `STMT_START` from `phase-tracker-helpers.ts` at module top level, so placing the helper in either of those two files would create an initialization cycle. `implementExemptDirs(specDirs)` in `extensions/lib/phase-tracker-helpers.ts` keeps its contract (the union of spec dirs and plan dirs, as `extensions/phase-tracker.ts:607` consumes it) and is reimplemented as `[...specDirs, ...planDirsFor(specDirs)]` deduplicated. No new settings key is introduced.

Skills obtain the same value through the existing `gauntlet_setting` tool, which gains a fourth key: `gauntlet_setting({ key: "flowGuards" })` returns `{ key, enforce, specDirs, planDirs, errors }` from the same `resolveFlowGuards` + `planDirsFor` pair. No skill hand-rolls a settings read.

### 2. Classifiers take the dirs

`extensions/lib/telemetry-paths.ts` loses both regex literals:

```ts
export const isSpecPath = (rel: string, specDirs: readonly string[]): boolean
export const isPlanPath = (rel: string, planDirs: readonly string[]): boolean
```

Each builds its match per entry as `(^|/)<escaped dir>/[^/]+\.md$`: a direct child `.md` of the dir at the repo root or under any service prefix (`svc/docs/specs/x.md` matches the way `svc/doc/specs/x.md` does today). Nested files (`docs/specs/sub/x.md`) do not match, as today. `recordPathFor` and `specHeaderOf` are unchanged: the record mirrors the spec path under `telemetry.dir`, which is why `docs/specs` records already land at `.pi/gauntlet/telemetry/docs/specs/<spec>.yaml`.

`extensions/telemetry.ts` reads settings only through its injected `Deps.settings(cwd) -> SettingsSnapshot` port (`telemetry.ts:44-57`). `SettingsSnapshot` gains `specDirs: string[]` and `planDirs: string[]`, populated by `realSettings` from `resolveFlowGuards` + `planDirsFor`; the test harness's fake snapshot (`telemetry.test.ts:59`) supplies them the same way. Every `isSpecPath`/`isPlanPath` call (12 sites: 11 spec, 1 plan - write-bind, warning, rename, superseded-link validation, shipped-write protection, plan read/write bind) takes the dirs from the snapshot. The exported pure helpers `resumeSpecOf`, `replayBranch`, and `isSafeSpecLink`, which run at session start without a ctx, take `specDirs` as an explicit parameter.

`extensions/lib/telemetry-ship.ts` `modifiedFilesFrom` takes `planDirs` instead of its `doc/plans` literal; `computeGitDiff`/`computeJjDiff` in `telemetry-diff.ts` thread it through. The seal resolves `flowGuards` for this one input (it still does not classify spec paths itself). `plan_check` keeps binding the plan's `**Spec:**` header without a path test: that association is intended, not a loophole, and a plan header naming a spec outside the resolved dirs still writes its record at `telemetry.dir/<that path>.yaml`.

`extensions/phase-tracker.ts` changes only where section 1 requires it: the `gauntlet_setting` key enum gains `flowGuards` and its handler returns `{ key, enforce, specDirs, planDirs, errors }`; the guards themselves consume the new default and `implementExemptDirs` unchanged.

### 3. The seal classifies by association, not by directory

`src/bins/gauntlet-telemetry-seal.mjs` already merges preset-over-repo settings for `telemetry.dir`; it stops importing `isSpecPath`. The existing `seal()` (`seal.mjs:82-90`) keeps its status handling and its exit contract as `skills/finishing-a-development-branch/SKILL.md:202` documents it: missing record -> `no record at <rec>`, exit 2; `in_progress` -> seal; `shipped` and uncommitted -> commit the bytes as they are (retry after a failed commit); `shipped` and clean -> `already sealed <rec>`.

- `--spec <path>`: convert to repo-relative (a path outside the checkout keeps today's `usage()` outcome, exit 1), map through `recordPathFor`, and hand to `seal()`. The `isSpecPath` gate at `seal.mjs:128` is removed; no new error is introduced.
- No `--spec`: walk `<telemetry.dir>` recursively for `*.yaml` records, parse each, and keep those whose `spec:` value is in the set of paths changed against `--base` (the changed set the bin already computes), regardless of status - `seal()` applies the status rules above, so a shipped-but-uncommitted retry and the idempotent `already sealed` line keep working without `--spec`. Zero candidates -> `no telemetry run`, exit 0 (existing). Every candidate is sealed, one line per record (existing behavior; no ambiguity branch). A walked record that fails to parse is skipped with `warning: unparseable record <rel>` on stderr; the other candidates still seal (an explicit `--spec` on that record still reports the corruption through `seal()`).
- A record whose `spec:` names a path in the changed set but absent from the worktree (spec renamed on the branch) still counts.
- A record whose spec did not change on this branch is ignored.

`skills/finishing-a-development-branch/SKILL.md` keeps passing the plan's `**Spec:**` value as `--spec`; its prose no longer says the path must be under `doc/specs`.

### 4. The spec index becomes a bundled bin

`bin/gauntlet-spec-index.mjs` moves to `src/bins/gauntlet-spec-index.mjs`; `scripts/build-bins.mjs` gains its entrypoint; the shipped `bin/gauntlet-spec-index.mjs` becomes a committed esbuild bundle like the two existing bins (AGENTS.md "Testing"). It imports `mergeGauntlet` and `resolveFlowGuards` from `extensions/lib/gauntlet-settings.ts` and reads preset + repo settings the same way the seal does.

Specs corpus: for each resolved spec dir `<d>`, collect `<d>/*.md` at the repo root and `<service>/<d>/*.md` under each visible service directory (replacing the two literals at lines 99-100). Docs corpus: a doc is excluded when its path contains a resolved spec dir or plan dir as a contiguous run of path components (literal component comparison, not glob interpolation - a configured `docs/[draft]/specs` is collected as a spec dir and excluded from docs the same way), replacing the hardcoded `**/doc/specs/**`, `**/docs/specs/**`, `**/doc/plans/**`, `**/docs/plans/**` entries, so the two corpora cannot overlap under any configuration. The `## Spec index` overrides section keeps its `- docs: <glob>` contract unchanged. The index's `.pi/gauntlet/telemetry` literal for the `files` column is out of scope here (record lookup, not spec-dir classification).

### 5. Skill prose

Where a skill states the contract rather than an example, it names the resolved value and how to get it: brainstorming's HARD CONSTRAINT write boundary and Filename Convention, writing-plans' plan save location, finishing's seal step, and gauntlet-resume's candidate resolver (`skills/gauntlet-resume/reference/reconstruction.md:29`, which today spells out `default ["doc/specs"]`) say "the resolved spec dirs from `gauntlet_setting({ key: "flowGuards" })` and their sibling `plans` dirs". Brainstorming's pick order for where a new spec is written: the project's routing prose (overrides file, `AGENTS.md`), else the one resolved dir that already exists in the repo, else the first resolved dir (`doc/specs` under the default). Example paths elsewhere in skill prose stay `doc/specs`. Edits follow `/skill:forge-skill`.

### Data flow

settings (preset, repo) -> `mergeGauntlet` -> `resolveFlowGuards` -> `{ specDirs }` -> `planDirsFor` -> telemetry `SettingsSnapshot`, phase guards, spec-index collect + exclude lists, `modifiedFilesFrom` plan exclusion, `gauntlet_setting({ key: "flowGuards" })` for skills. The seal selects records by their `spec:` field, not by directory; it resolves `flowGuards` only for the `modifiedFilesFrom` plan exclusion.

## Errors and edge cases

- `flowGuards.specDirs` set to `[]` or a non-array: default applies; seal, index, telemetry all inherit it.
- `"docs/specs/"` and `"./docs/specs"` normalize to `docs/specs` before pattern building.
- Both `doc/specs/` and `docs/specs/` populated in one repo: the index lists both; telemetry treats both as spec dirs. That is the stated default, not a conflict.
- Seal auto-selection with two records whose specs both changed: both are sealed, one line each (existing behavior).
- `--spec` with no record: `no record at <rec>`, exit 2 (existing `seal()` path). `--spec` outside the checkout: usage, exit 1 (existing).
- Brainstorm confinement still warns on a write outside the resolved dirs; a `plan_check` header pointing there still binds. Guard and binding are separate concerns.
- Stale `bin/gauntlet-spec-index.mjs` after a `src/bins/` edit: the existing CI bundle-freshness check fails the run.
- A repo whose preset sets `flowGuards` and whose repo settings also set `flowGuards`: shallow merge at the `piGauntlet` block, repo object replaces preset object (existing behavior, unchanged).

## Tests

- `extensions/lib/telemetry-paths.test.ts`: with the default dirs, `isSpecPath` accepts `doc/specs/x.md`, `docs/specs/x.md`, `svc/docs/specs/x.md`; rejects `docs/specs/sub/x.md`, `docs/spec/x.md`, `doc/plans/x.md`. `isPlanPath` mirrors with `plans`. With `["design/specs"]`, accepts only `design/specs/x.md` and rejects both defaults. `planDirsFor(["doc/specs", "design/specs"])` -> `["doc/plans", "design/plans"]`.
- `extensions/lib/gauntlet-settings.test.ts`: unset -> `["doc/specs", "docs/specs"]`; `[]` and `"x"` -> default; explicit list replaces it entirely.
- `extensions/lib/gauntlet-settings.test.ts`: `planDirsFor(["doc/specs", "design/specs"])` -> `["doc/plans", "design/plans"]`; `extensions/lib/phase-tracker-helpers.test.ts:248` (`implementExemptDirs` union) passes unchanged.
- Module-order test: importing `phase-tracker-helpers.ts` before `telemetry-paths.ts` and the reverse both initialize without a TDZ error.
- `bin/gauntlet-telemetry-seal.test.mjs`: existing `doc/specs` fixtures pass unchanged, including the exit-2 missing-record case (`seal.test.mjs:178`) and the shipped-uncommitted retry (`seal.test.mjs:167`); a `docs/specs` fixture with an `in_progress` record seals with and without `--spec`; a shipped-uncommitted `docs/specs` record commits on retry without `--spec`; a record whose spec did not change is ignored; a `docs/plans/x.md` change on the branch is absent from the sealed record's `derived.modified_files`.
- `extensions/lib/telemetry-ship.test.ts` / `telemetry-diff.test.ts`: `modifiedFilesFrom` excludes `doc/plans/x.md` and `docs/plans/x.md` under the default and `design/plans/x.md` under `["design/specs"]`, for both the git and jj diff paths.
- `bin/gauntlet-spec-index.test.mjs`: a repo with only `docs/specs/` returns rows; repo `flowGuards.specDirs: ["design/specs"]` collects from `design/specs` and nothing from `doc/specs` or `docs/specs`; the docs corpus excludes the configured spec and plan dirs; a spec dir with glob metacharacters (`docs/[draft]/specs`) is both collected and excluded from docs.
- `extensions/telemetry.test.ts`: the fake `SettingsSnapshot` carries `specDirs`/`planDirs`; the binding tests re-run with a `docs/specs` spec write and confirm the record lands at `telemetry.dir/docs/specs/<spec>.yaml` and transitions; `replayBranch` with a custom dir list resumes the matching spec.
- `extensions/phase-tracker.test.ts`: existing `specDirs` tests pass; a `docs/specs` write under the default no longer warns; `gauntlet_setting({ key: "flowGuards" })` returns the default `specDirs`/`planDirs` and a repo override.
- `scripts/packed-install-smoke.test.mjs`: adds an invocation of the packed `bin/gauntlet-spec-index.mjs` from the scratch `node_modules/pi-gauntlet` alongside the two existing bins; `scripts/ci.mjs` bundle freshness covers the third bundle.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `doc/configuration.md` (`flowGuards.specDirs` default and widened meaning - governs telemetry classification, ship-time plan exclusion, and the spec index, not only phase confinement; `gauntlet_setting` gains the `flowGuards` key); `README.md#spec-search-index` (corpus collection follows `specDirs`); `CHANGELOG.md` Unreleased entry
- Derived / memory docs invalidated: `AGENTS.md` Testing paragraph (names the bundled bins; the index joins them)

Materiality per `reference/documentation-impact.md`. Skill bodies (brainstorming, writing-plans, finishing) are implementation surface, not doc-impact entries. The predecessor spec receives a supersession banner, which is a spec edit, not a doc-impact entry.

## Out of scope

- Parsing `.pi/gauntlet-overrides.md` prose (`Specs:` lines) as configuration.
- Filesystem detection of spec dirs.
- Validating the `plan_check` `**Spec:**` header against the resolved dirs.
- Nested spec files (`docs/specs/sub/x.md`); the direct-child rule stays.
- Adding `flowGuards.specDirs` to the consumer repo's settings (outside this repo).
- Reworking the `## Spec index` overrides contract.
- The spec index's `.pi/gauntlet/telemetry` literal for its `files` column (record lookup, not spec-dir classification).
- Any seal ambiguity rule for multiple matching records; the seal keeps sealing every candidate.

## Open questions

none
