import assert from "node:assert/strict";
import { test } from "node:test";
import { guardReason, modifiedFilesFrom } from "./telemetry-ship.ts";

test("guardReason names spec, timestamp and record path", () => {
  assert.equal(
    guardReason("doc/specs/a.md", "2026-09-17T12:00:00Z", ".pi/gauntlet/telemetry/doc/specs/a.yaml"),
    "spec doc/specs/a.md shipped at 2026-09-17T12:00:00Z (record .pi/gauntlet/telemetry/doc/specs/a.yaml). Write a new date-slugged spec that supersedes it instead of reusing this file.",
  );
});

const PLANS = ["doc/plans", "docs/plans"];

test("modifiedFilesFrom drops the spec, every configured plan dir, and the telemetry dir; sorts", () => {
  const names = "extensions/telemetry.ts\nextensions/telemetry.test.ts\ndoc/specs/a.md\ndoc/plans/a.md\ndocs/plans/c.md\nsvc/doc/plans/b.md\n.pi/gauntlet/telemetry/doc/specs/a.yaml\nREADME.md\n\n";
  assert.deepEqual(modifiedFilesFrom(names, "doc/specs/a.md", ".pi/gauntlet/telemetry", PLANS), ["README.md", "extensions/telemetry.test.ts", "extensions/telemetry.ts"]);
  assert.deepEqual(modifiedFilesFrom("design/plans/x.md\nsrc/a.ts\n", "design/specs/a.md", "t/", ["design/plans"]), ["src/a.ts"]);
  assert.deepEqual(modifiedFilesFrom("doc/plans/x.md\n", "design/specs/a.md", "t/", ["design/plans"]), ["doc/plans/x.md"]);
  assert.deepEqual(modifiedFilesFrom("", "doc/specs/a.md", "t/", PLANS), []);
  const namesWithWhitespace = " lead.ts\ntrail.ts \nREADME.md\n";
  assert.deepEqual(modifiedFilesFrom(namesWithWhitespace, "doc/specs/a.md", "t/", PLANS), [" lead.ts", "README.md", "trail.ts "]);
});
