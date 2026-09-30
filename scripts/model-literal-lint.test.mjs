import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXCLUDED_PREFIXES, MODEL_LITERAL, SCOPE_DIRS, SCOPE_FILES, lintModelLiterals } from "./model-literal-lint.mjs";
assert.deepEqual(SCOPE_DIRS, ["skills", "agents", "extensions"]);
assert.deepEqual(SCOPE_FILES, ["README.md", "AGENTS.md", "AGENTS.core.md"]);
assert.deepEqual(EXCLUDED_PREFIXES, []);
assert.equal(MODEL_LITERAL.flags, "i");

// AC1 floor, substring, case-insensitive; additive families
for (const s of ['model: "anthropic/x"', "OpenAI/gpt", "haiku4", "gpt-example", "Gemini", "grok", "xai/a", "mistral/b"]) {
  assert.ok(MODEL_LITERAL.test(s), s);
}
for (const s of ["p/main", "x/y", "the model string", "agentOverrides"]) {
  assert.ok(!MODEL_LITERAL.test(s), s);
}

const tmp = mkdtempSync(join(tmpdir(), "model-literal-lint-"));
try {
  const write = (rel, text) => {
    mkdirSync(dirname(join(tmp, rel)), { recursive: true });
    writeFileSync(join(tmp, rel), text);
  };
  write("skills/foo/SKILL.md", 'ok line\nmodel: "anthropic/x"\n');
  write("extensions/x.mjs", "const m = 'haiku4';\n");
  write("extensions/x.test.ts", 'const model = "p/main";\n');
  write("README.md", "no literal here\n");

  const rows = lintModelLiterals(tmp).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(rows, [
    { path: "extensions/x.mjs", line: 1, text: "const m = 'haiku4';" },
    { path: "skills/foo/SKILL.md", line: 2, text: 'model: "anthropic/x"' },
  ]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("model-literal-lint fixtures pass");
