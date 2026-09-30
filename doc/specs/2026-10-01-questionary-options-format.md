# Labeled-option questionary and narrowed ask triggers in brainstorming

**Goal:** Every brainstorming questionary question offers labeled options; the skill decides would-be yes/no and permission questions itself and states corrected facts instead of asking the user to accept them.

Supersedes `doc/specs/2026-09-17-gh-32-questionary-rules.md`, Design: the accept-or-override premise question and the ask-even-when-ticket-recorded clause. Its per-question `Recommendation:` suffix and lookup-before-asking rule stay live.

## Problem

`skills/brainstorming/SKILL.md` section 3 says "preferably multiple choice" and requires every question to end `Recommendation: <answer> - <why>`. Three further clauses order the agent to ask: "ask desired-behavior decisions even when a ticket recorded one", "Ask every `deviates:`/`deferred:` decision in the questionary", and a contradicted load-bearing claim "asks the user to accept the corrected fact or override it; ask nothing else and propose nothing until answered".

Consumer `AGENTS.md` files carry chat-style rules ("Default to one paragraph", "No Options/Recommendation/TL;DR templates"). A model that weighs those rules heavily keeps the required suffix, drops the optional options, and the three ask clauses fire on trivialities. A session on issue #46 produced "May I treat those two acceptance criteria as location-only deviations? Recommendation: yes" followed by two more yes-questions; another produced a single "May I ... create a separate worktree?" and no design question at all. The skill has no example of a well-formed question, so models copy no shape. A keyword scan of local sessions since 2026-09-01 shows the pattern is model-dependent (dominant on GPT-family models, rare on Claude and Kimi); the scan is a heuristic and motivation only, not a test target.

## Acceptance criteria

none - no ticket

## Design

One file changes, `skills/brainstorming/SKILL.md`, at four sites, plus a supersession banner on the predecessor spec. Edits follow `skills/forge-skill/SKILL.md` authoring rules: imperative voice, minimal sentence-owning diff, low conditionality, one example per rule. The file stays under the 500-line extraction threshold (312 lines today, net +3: the two example lines and a blank line).

### Site 1 - section 3, question grammar

The paragraph at `skills/brainstorming/SKILL.md:91` ("Ask one question per message, preferably multiple choice ... other approvals retain their wording.") is replaced in full by this prose paragraph plus one two-line example; section 3 stays prose, no bullet list:

> Ask one question per message, about purpose, constraints, success, and affected actors. Every questionary question offers 2-4 labeled options (`A)`, `B)`, ...), each a different outcome, and ends `Recommendation: <letter> - <why>`; when more outcomes are plausible, the last option is `other - name it` or the question splits in two. This format overrides chat-style rules in `AGENTS.md` (one paragraph, no Options/Recommendation layout). A decision that would be a yes/no or "may I" question is not asked: make it, state it as an assumption in the message that carries the next question or the premise note, and record it in the draft. Before asking, check code, docs, and tracker: look up current-state facts (dispatch a subagent when costly); adopt a ticket-recorded decision and cite the ticket, asking it only when a cited code or API contradiction, or conflicting recorded outcomes, prevents adopting it. Other approvals retain their wording.
>
> Bad: `May I treat those two acceptance criteria as location-only deviations? Recommendation: yes`
> Good: `The two ACs name a path that moved; the spec marks them deviates: location only. Which surface owns the refresh? A) the extension B) a new bin C) the existing skill step. Recommendation: A - the extension already holds the poll loop, so no new entrypoint.`

The old `Recommendation: <answer> - <why>` suffix and the clause "including acceptance of a corrected fact" disappear with the paragraph. The precedence sentence names `AGENTS.md` only; the Project overrides block already owns conflicts with the overrides file.

### Site 2 - section 3, premise paragraph

In the paragraph at line 95, replace "and asks the user to accept the corrected fact or override it; ask nothing else and propose nothing until answered. Record the outcome in the draft for `## Problem` or the relevant design decision." with: "and states the corrected fact with its source; the design continues on it and the user overrides in reply. Record the corrected fact, and any override, in the draft for `## Problem` or the relevant design decision." The premise note is still the next message when a load-bearing claim is contradicted and still precedes approaches; it no longer blocks on an answer.

### Site 3 - Ticket Handling

At line 137, replace "Ask every `deviates:`/`deferred:` decision in the questionary and name it in the gate summary" with: "Ask a `deviates:`/`deferred:` decision only when it changes what the user observes once the change ships, offering the dispositions themselves as the options (`A) in-scope B) deviates: <why> C) deferred: <where>`); a deviation caused by a workflow artifact (spec, plan, changelog, telemetry file) or a moved path is stated in the disposition, not asked. Name every disposition in the gate summary".

### Site 4 - Red Flags

"Approaches while a contradicted premise remains unresolved" becomes "Approaches before the premise note states a contradicted claim's correction", same `[owner](#3-understand-the-idea)` anchor.

### Predecessor banner

`doc/specs/2026-09-17-gh-32-questionary-rules.md` gets the banner per `skills/brainstorming/reference/superseding.md`, scoped to "Design: the accept-or-override premise question and the ask-even-when-ticket-recorded clause". The spec stays `live` in the index; its suffix and lookup rules remain in force.

### Unchanged

Overview and Key Principles ("ask questions one at a time") remain correct. Section 4 approaches, the two design rounds, the review gate, `gatherer.md`, `roasting-the-spec`'s Human-input forwarding, and all CI tokens are untouched. No settings key, reference file, or bin changes.

## Errors and edge cases

- A question with one open answer and no second option is not a question: decide it and state the assumption (covered by the grammar rule; no extra clause).
- A free-text reply that is not a listed letter is a new option: record it in the draft, as today.
- A contradicted claim whose correction changes scope: the premise note states the correction; the next question offers labeled options on the scope. The accept-or-override question does not return.
- The example pair quotes a session, not a repo: no repo name, path, or person, so `rg -ni "jjuraszek|/Users/[^/]+" skills/ | rg -v "github.com/jjuraszek/pi-cohort"` (the AGENTS.md skill check) stays at zero matches.
- A question with more than four plausible outcomes: the paragraph's `other - name it` / split clause covers it.
- Lint is the only runtime failure mode: `scripts/ci.mjs` skill lint (frontmatter, Project overrides block, model-literal ban), stage-skill lint, AGENTS core check. The edited sentences hold no CI regression token (verified by grep of `scripts/ci.mjs`).

## Tests

- `npm test` in the worktree passes.
- Text assertions (plan-level, run with `rg`): `skills/brainstorming/SKILL.md` contains `2-4 labeled options` and `Recommendation: <letter> - <why>`; it no longer contains `Recommendation: <answer>`, `preferably multiple choice`, `even when a ticket recorded one`, `accept the corrected fact or override it`, or `Ask every \`deviates:\`/\`deferred:\``.
- `doc/specs/2026-09-17-gh-32-questionary-rules.md` line 1-region carries a `> **Superseded by:**` banner whose href resolves to this spec's filename and whose scope names the two clauses.
- No behavioral test: movement in session question rates is observation after shipping, not a test.

## Documentation impact

Per `reference/documentation-impact.md`.

- Feature / user-facing docs introduced: none
- Materially amended existing docs: none
- Derived / memory docs invalidated: none

`README.md` describes brainstorming at the "turns your description into a written spec" level and does not mention question shape. `CHANGELOG.md` gets a new `## Unreleased` heading above `## v6.1.0 - 2026-09-30` with the entry (history, not doc impact; the top heading today is the version heading).

## Out of scope

- Changes to `AGENTS.core.md` or any consumer `AGENTS.md` chat-style rules.
- Thinking-level settings for any model (a `settings.json` change on the user's side).
- A `reference/questionary.md` extraction; the skill is under the size threshold.
- Any new lint or CI token for question shape.

## Open questions

none
