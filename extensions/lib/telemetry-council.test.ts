import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCouncil, memberSlugOf, normalizeRaisedBy, parseAudit, parseChairReport, resolveMembers, slug } from "./telemetry-council.ts";

const zero = { blocker: 0, major: 0, minor: 0 };
test("slug and member filename normalization", () => {
  assert.equal(slug("p/alpha:xhigh"), "p-alpha-xhigh");
  assert.equal(memberSlugOf("/tmp/retry/member-2-p-beta-high.md"), "p-beta-high");
  assert.equal(memberSlugOf("/tmp/member-0-p-alpha"), "p-alpha");
  assert.equal(memberSlugOf(undefined), undefined);
  assert.equal(memberSlugOf("chair.md"), undefined);
  assert.equal(normalizeRaisedBy("member-0-p-alpha"), "p-alpha");
  assert.equal(normalizeRaisedBy("p-alpha.md"), "p-alpha");
  assert.equal(normalizeRaisedBy(" p/alpha:xhigh "), "p-alpha-xhigh");
});
const chairText = [
  "consensus: needs-work",
  "clusters:",
  "- [blocker] issue — raised-by: [p-alpha] — fix",
  "- [Major] issue - raised-by: [p-alpha, p-beta-high, p-alpha] - fix",
  "- [minor] issue -- raised-by: [p-beta-high] -- cut",
  "resolved:",
  "- [blocker] ignored — raised-by: [nobody]",
].join("\n");
test("chair clusters parse only before resolved and require attributes", () => {
  assert.deepEqual(parseChairReport(chairText), { clusters: [
    { severity: "blocker", raisedBy: ["p-alpha"] },
    { severity: "major", raisedBy: ["p-alpha", "p-beta-high"] },
    { severity: "minor", raisedBy: ["p-beta-high"] },
  ] });
  assert.equal(parseChairReport("clusters:\n"), null);
  assert.equal(parseChairReport("consensus: x\n"), null);
  assert.deepEqual(parseChairReport("consensus: sound\nclusters:\nresolved:\n"), { clusters: [] });
  assert.equal(parseChairReport("consensus: x\nclusters:\n- [major] no raiser"), null);
});
const auditText = [
  "Applied: [blocker] issue — raised-by: [p-alpha] -> fix",
  "- Applied: [major] over-spec — raised-by: [p-alpha, p-beta-high] -> cut",
  "Applied: [minor] issue — raised-by: [p-beta-high] -> open question (missing)",
  "Deferred: [major] x — raised-by: [p-alpha] -> later",
  "Rejected: [minor] issue — raised-by: [p-beta-high] -> no",
].join("\n");
test("audit reads dispositions, none and cut/open question", () => {
  assert.deepEqual(parseAudit(auditText), [
    { disposition: "applied", severity: "blocker", raisedBy: ["p-alpha"] },
    { disposition: "applied", severity: "major", raisedBy: ["p-alpha", "p-beta-high"] },
    { disposition: "applied", severity: "minor", raisedBy: ["p-beta-high"] },
    { disposition: "deferred", severity: "major", raisedBy: ["p-alpha"] },
    { disposition: "rejected", severity: "minor", raisedBy: ["p-beta-high"] },
  ]);
  assert.equal(parseAudit("Applied: [major] x — raised-by: [p-alpha]\nDeferred: none"), null);
  assert.equal(parseAudit("Applied: x — raised-by: [p-alpha]\nDeferred: none\nRejected: none"), null);
  assert.equal(parseAudit("Applied: [major] x\nDeferred: none\nRejected: none"), null);
  assert.deepEqual(parseAudit("Applied: none\nDeferred: none\nRejected: none"), []);
});
const results = [
  { model: "p/alpha:xhigh", exitCode: 0, savedOutputPath: "/tmp/member-0-p-alpha.md" },
  { model: "p/beta:high", exitCode: 1 },
  { model: "p/beta:high", exitCode: 0, savedOutputPath: "/tmp/retry/member-1-p-beta-high.md" },
];
test("member retry counts dispatches and ambiguous slug fails", () => {
  const members = resolveMembers(results)!;
  assert.deepEqual([...members.dispatches], [["p/alpha:xhigh", 1], ["p/beta:high", 2]]);
  assert.deepEqual([...members.slugToModel], [["p-alpha", "p/alpha:xhigh"], ["p-beta-high", "p/beta:high"]]);
  assert.equal(resolveMembers([...results, { model: "p/other", exitCode: 0, savedOutputPath: "/tmp/member-3-p-alpha.md" }]), null);
  assert.deepEqual([...resolveMembers([{ exitCode: 0, savedOutputPath: "/tmp/member-0-x.md" }])!.dispatches], []);
});
const clusters = [{ severity: "blocker" as const, raisedBy: ["p-alpha"] }, { severity: "major" as const, raisedBy: ["p-alpha", "p-beta-high"] }, { severity: "minor" as const, raisedBy: ["p-beta-high"] }];
const audit = [{ disposition: "applied" as const, severity: "blocker" as const, raisedBy: ["p-alpha"] }, { disposition: "deferred" as const, severity: "major" as const, raisedBy: ["p-beta-high", "p-alpha"] }, { disposition: "rejected" as const, severity: "minor" as const, raisedBy: ["p-beta-high"] }];
const input = () => ({ chair: { model: "p/chair:medium", dispatches: 2, clusters }, members: resolveMembers(results)!, audit });
test("council joins multiset and counts each severity per member", () => {
  const block = buildCouncil(input())!;
  assert.deepEqual(block.chair, { model: "p/chair:medium", dispatches: 2, clusters: 3, members_reported: 2 });
  assert.deepEqual(block.members["p/alpha:xhigh"], { dispatches: 1, total: { blocker: 1, major: 1, minor: 0 }, unique: { blocker: 1, major: 0, minor: 0 }, applied: { blocker: 1, major: 0, minor: 0 }, unique_applied: { blocker: 1, major: 0, minor: 0 }, deferred: { blocker: 0, major: 1, minor: 0 }, rejected: zero });
  assert.deepEqual(block.members["p/beta:high"], { dispatches: 2, total: { blocker: 0, major: 1, minor: 1 }, unique: { blocker: 0, major: 0, minor: 1 }, applied: zero, unique_applied: zero, deferred: { blocker: 0, major: 1, minor: 0 }, rejected: { blocker: 0, major: 0, minor: 1 } });
  for (const member of Object.values(block.members)) for (const severity of ["blocker", "major", "minor"] as const) assert.equal(member.total[severity], member.applied[severity] + member.deferred[severity] + member.rejected[severity]);
});
test("zero-member and zero-finding completeness", () => {
  const members = resolveMembers([...results, { model: "p/gamma:high", exitCode: 0, savedOutputPath: "/tmp/member-2-p-gamma-high.md" }])!;
  const block = buildCouncil({ ...input(), members })!;
  assert.deepEqual(block.members["p/gamma:high"], { dispatches: 1, total: zero, unique: zero, applied: zero, unique_applied: zero, deferred: zero, rejected: zero });
  assert.equal(block.chair.members_reported, 2);
  assert.deepEqual(buildCouncil({ ...input(), chair: { model: "p/chair:medium", dispatches: 1, clusters: [] }, audit: [] })!.chair, { model: "p/chair:medium", dispatches: 1, clusters: 0, members_reported: 0 });
});
test("incomplete batches return null", () => {
  assert.equal(buildCouncil({ ...input(), audit: [...audit, { disposition: "rejected", severity: "minor", raisedBy: ["p-nobody"] }] }), null);
  assert.equal(buildCouncil({ ...input(), chair: { ...input().chair, clusters: [...clusters, { severity: "minor", raisedBy: ["p-nobody"] }] } }), null);
  assert.equal(buildCouncil({ ...input(), audit: [...audit, { disposition: "rejected", severity: "minor", raisedBy: ["p-alpha"] }] }), null);
  assert.equal(buildCouncil({ ...input(), audit: audit.slice(0, 2) }), null);
  assert.equal(buildCouncil({ ...input(), audit: [{ ...audit[0], severity: "major" }, audit[1], audit[2]] }), null);
});
