---
name: forge-skill
description: Use when creating or editing a SKILL.md, a skill's reference file, an agent persona, a prompt template, or a slash command in pi or Claude Code - including one-line edits - or when such a file exceeds 500 lines, gains if/else branching, or drifts from imperative voice; the authoring skill for repos that follow gauntlet's conventions.
---

# Forge Skill

## Overview

This skill governs every file a model reads as instructions: `SKILL.md` and its reference files, agent personas, prompt templates, and slash commands, in pi and in Claude Code. Every sentence below is a rule to apply or a fact to check.

## Conventions

Sources: pi - `docs/skills` in `@earendil-works/pi-coding-agent`; Claude Code - `code.claude.com/docs/en/skills`.

| Item | pi | Claude Code |
|---|---|---|
| Frontmatter | `---` on line 1, `name` and `description`, closing `---` | Same; an unknown field is ignored silently; unparseable YAML loads the skill with no fields |
| `name` | Lowercase letters, digits, hyphens; no leading, trailing, or doubled hyphen; at most 64 chars; match the directory name (Agent Skills standard; pi does not enforce it) | Display label for a personal or project skill (the command is the directory name); the last command segment for a plugin skill |
| `description` | At most 1024 chars; a skill without one is not loaded | Recommended; `description` plus `when_to_use` is cut at 1536 chars in the listing |
| Harness-only fields | `license`, `compatibility`, `metadata`, `allowed-tools` (spec-listed, not enforced) | `when_to_use`, `argument-hint`, `arguments`, `user-invocable`, `allowed-tools` (enforced) |
| `disable-model-invocation: true` | Command-only skill | Same; also excluded from subagent preload |
| Invocation | `/skill:name [args]` | `/name [args]`, or `/plugin:name` for a plugin skill |
| Supporting files | `reference/<topic>.md` (gauntlet convention; pi docs show `references/`), read at the step that names it; dispatch payloads sit beside `SKILL.md` | Any file linked by relative path; `references/`, `scripts/`, `assets/` by convention; `scripts/` files are executed, not loaded |
| Substitutions | None; the body is read as written | Argument tokens and `CLAUDE_*` variables in the dollar form expand before the model reads the body. In prose, prefix an argument token with one backslash (backslash, dollar, ARGUMENTS) and name a variable bare (`CLAUDE_SKILL_DIR`) |
| Locations | `.pi/skills/`, `~/.pi/agent/skills/`, `.agents/skills/`, `~/.agents/skills/`, a package's `skills/` dir | `.claude/skills/`, `~/.claude/skills/`, a plugin's `skills/` dir; `.agents/skills/` is not read |
| Reload after edit | `/reload` | Watched for `.claude/skills/` and `~/.claude/skills/`; a plugin skill needs a new session |

## Authoring rules

These rules bind the lines an edit adds or changes. Leave other lines alone.

- Imperative voice. Write instructions as commands. Never "should", "consider", "you may want to", "it is recommended".
- Low conditionality. One path per step: branch only on a runtime fact the model can observe - a tool result, a file's presence, a settings value - never on the reader's judgment. Two branches is the ceiling; a third goes into a table or a `reference/` file.
- Minimal diff. A rule change touches the sentence that owns the rule, not the section. Never restate a rule in a second place; link the owner.
- Oversized file. A change touching a file over 500 lines extracts the concern it touches - or the largest self-contained `##` section - into `reference/<topic>.md` in the same change, and leaves a one-line "read X now" pointer at the step that needs it.
- Recipe over prohibition. A shape or quality problem gets a statement of what the output is; a discipline problem gets one explicit rule. Never a list of things to avoid.
- No nuance clauses. "Unless it matters", "when appropriate", "if needed" reopen the decision; delete them or name the observable condition.
- Description is a trigger. State when to load the skill (symptoms, file types, situations); never summarize its steps.
- One example. One concrete example per rule, never three.
- Skip what the model knows. No explanations of git, shell, or the harness.
- Never force-load. Cross-reference a skill by its invocation name (pi `/skill:name`, Claude Code `/name` or `/plugin:name`); never with `@`.
- ASCII punctuation, compact `|---|` table separators, present tense.

## Edit procedure

1. Read the whole file.
2. Locate and edit the sentence that owns the rule you are changing (see Minimal diff).
3. Read the changed lines back against `## Authoring rules`.
4. Run `wc -l` on the file; over 500 lines, extract per the oversized-file rule.
5. pi: run `/reload`. Claude Code: start a new session.

## Test (optional)

Run after adding a rule or rewording a discipline rule.

1. Write one scenario prompt the rule governs.
2. In one turn dispatch two fresh workers: the loaded worker's task is the scenario plus the full `SKILL.md` body; the baseline worker's task is the scenario alone.
3. Compare the two outputs. Fold every excuse the baseline gives into the rule sentence it evades.

| Harness | Dispatch |
|---|---|
| pi | `subagent({ agent: "worker", context: "fresh", task })` twice, one task with the body appended |
| Claude Code | The harness's subagent dispatch tool, twice, same split |

## Project overrides

If a gauntlet overrides file exists - checked in order: `.pi/gauntlet-overrides.md`, `<repo root>/gauntlet-overrides.md`, `<repo root>/doc/gauntlet-overrides.md`; first found wins - read it. Read and apply `## conventions` whenever present, without a relevance judgment. Give this skill's named section precedence over conflicting `## conventions` rules. Use other relevant sections - by name match, by topic (routing, verification, worktrees, etc.), or by workflow convention - to override or extend the instructions above. Project-local `AGENTS.md` is already in context - check it for project-specific routing tables, service paths, and verification commands.
