import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Skills never name a provider or model (#42). AC1's alternation is the floor; the
// trailing families are additive. Substring, case-insensitive: `haiku4` must match.
export const MODEL_LITERAL = /anthropic\/|openai\/|github-copilot\/|google\/|haiku|sonnet|opus|gpt-|xai\/|mistral\/|gemini|grok/i;
export const SCOPE_DIRS = ["skills", "agents", "extensions"];
export const SCOPE_FILES = ["README.md", "AGENTS.md", "AGENTS.core.md"];
export const EXCLUDED_PREFIXES = [];

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

// lintModelLiterals(root) -> { path, line, text }[]; path is root-relative, line is 1-based.
export function lintModelLiterals(root) {
  const files = [];
  for (const dir of SCOPE_DIRS) {
    const path = join(root, dir);
    if (existsSync(path)) walk(path, files);
  }
  for (const file of SCOPE_FILES) {
    const path = join(root, file);
    if (existsSync(path)) files.push(path);
  }
  const findings = [];
  for (const file of files) {
    const path = relative(root, file).split(sep).join("/");
    if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
    readFileSync(file, "utf8").split("\n").forEach((raw, i) => {
      if (MODEL_LITERAL.test(raw)) findings.push({ path, line: i + 1, text: raw.trim() });
    });
  }
  return findings;
}
