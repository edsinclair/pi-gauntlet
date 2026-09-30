// Pure ship-time helpers for the telemetry extension: diff file filter and guard block reason.

export const guardReason = (spec: string, shippedAt: string, recordRel: string): string =>
  `spec ${spec} shipped at ${shippedAt} (record ${recordRel}). Write a new date-slugged spec that supersedes it instead of reusing this file.`;

// derived.modified_files: `git diff --name-only <base>...HEAD` output minus the bound
// spec, every configured plan dir (<planDir>/** at any prefix), and <dir>/**; sorted repo-relative paths.
export function modifiedFilesFrom(nameOnly: string, spec: string, dir: string, planDirs: readonly string[]): string[] {
  const dirPrefix = dir.replace(/\/+$/, "") + "/";
  const planRes = planDirs.map((d) => new RegExp(`(^|/)${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`));
  return nameOnly
    .split("\n")
    .filter((f) => f && f !== spec && !planRes.some((re) => re.test(f)) && !f.startsWith(dirPrefix))
    .sort();
}
