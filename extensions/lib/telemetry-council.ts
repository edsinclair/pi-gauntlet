export type Severity = "blocker" | "major" | "minor";
export type Disposition = "applied" | "deferred" | "rejected";
export type SeverityCounts = Record<Severity, number>;
export interface Cluster { severity: Severity; raisedBy: string[] }
export interface AuditItem extends Cluster { disposition: Disposition }
export interface CouncilMember {
  dispatches: number; total: SeverityCounts; unique: SeverityCounts; applied: SeverityCounts;
  unique_applied: SeverityCounts; deferred: SeverityCounts; rejected: SeverityCounts;
}
export interface CouncilBlock {
  chair: { model: string; dispatches: number; clusters: number; members_reported: number };
  members: Record<string, CouncilMember>;
}
export interface MemberResult { model?: string; exitCode?: number; savedOutputPath?: string }
export interface ResolvedMembers { dispatches: Map<string, number>; slugToModel: Map<string, string> }
const zero = (): SeverityCounts => ({ blocker: 0, major: 0, minor: 0 });
export const slug = (model: string): string => model.replace(/[^A-Za-z0-9]/g, "-");
export function memberSlugOf(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return /^member-\d+-(.+?)(\.md)?$/.exec(path.split(/[\\/]/).pop() ?? "")?.[1];
}
export const normalizeRaisedBy = (token: string): string => slug(token.trim().replace(/^member-\d+-/, "").replace(/\.md$/, ""));
const attributes = (line: string): Cluster | undefined => {
  const severity = /\[(blocker|major|minor)\]/i.exec(line);
  const raisers = /raised-by:\s*\[([^\]]*)\]/i.exec(line);
  if (!severity || !raisers) return undefined;
  const raisedBy = [...new Set(raisers[1].split(",").map(normalizeRaisedBy).filter((x) => x && x !== "-"))];
  return raisedBy.length ? { severity: severity[1].toLowerCase() as Severity, raisedBy } : undefined;
};
export function parseChairReport(text: string): { clusters: Cluster[] } | null {
  if (!/^consensus:/m.test(text)) return null;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^clusters:\s*$/.test(line));
  if (start < 0) return null;
  const clusters: Cluster[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^resolved:/.test(line)) break;
    if (!/^\s*[-*]\s+/.test(line)) continue;
    const item = attributes(line);
    if (!item) return null;
    clusters.push(item);
  }
  return { clusters };
}
export function parseAudit(text: string): AuditItem[] | null {
  const seen = new Set<string>();
  const items: AuditItem[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(?:[-*]\s*)?(Applied|Deferred|Rejected):\s*(.*)$/.exec(line);
    if (!match) continue;
    const disposition = match[1].toLowerCase() as Disposition;
    seen.add(disposition);
    if (match[2].trim().toLowerCase() === "none") continue;
    const item = attributes(match[2]);
    if (!item) return null;
    items.push({ disposition, ...item });
  }
  return seen.size === 3 ? items : null;
}
export function resolveMembers(results: MemberResult[]): ResolvedMembers | null {
  const dispatches = new Map<string, number>();
  const slugToModel = new Map<string, string>();
  for (const result of results) {
    if (typeof result.model !== "string") continue;
    dispatches.set(result.model, (dispatches.get(result.model) ?? 0) + 1);
    const memberSlug = result.exitCode === 0 ? memberSlugOf(result.savedOutputPath) : undefined;
    if (!memberSlug) continue;
    const previous = slugToModel.get(memberSlug);
    if (previous !== undefined && previous !== result.model) return null;
    slugToModel.set(memberSlug, result.model);
  }
  return { dispatches, slugToModel };
}
export interface CouncilInput {
  chair: { model: string; dispatches: number; clusters: Cluster[] };
  members: ResolvedMembers;
  audit: AuditItem[];
}
export function buildCouncil(input: CouncilInput): CouncilBlock | null {
  const resolve = (slugs: string[]): string[] | undefined => {
    const models = new Set<string>();
    for (const memberSlug of slugs) {
      const model = input.members.slugToModel.get(memberSlug);
      if (model === undefined) return undefined;
      models.add(model);
    }
    return [...models].sort();
  };
  const key = (severity: Severity, models: string[]) => JSON.stringify([severity, models]);
  const reported = new Set<string>();
  const clusterKeys: string[] = [];
  for (const cluster of input.chair.clusters) {
    const models = resolve(cluster.raisedBy);
    if (!models) return null;
    for (const model of models) reported.add(model);
    clusterKeys.push(key(cluster.severity, models));
  }
  const resolvedAudit: { item: AuditItem; models: string[] }[] = [];
  for (const item of input.audit) {
    const models = resolve(item.raisedBy);
    if (!models) return null;
    resolvedAudit.push({ item, models });
  }
  if (JSON.stringify(clusterKeys.sort()) !== JSON.stringify(resolvedAudit.map(({ item, models }) => key(item.severity, models)).sort())) return null;
  const members: Record<string, CouncilMember> = {};
  for (const [model, dispatches] of [...input.members.dispatches].sort(([a], [b]) => a.localeCompare(b))) {
    members[model] = { dispatches, total: zero(), unique: zero(), applied: zero(), unique_applied: zero(), deferred: zero(), rejected: zero() };
  }
  for (const { item, models } of resolvedAudit) {
    for (const model of models) {
      const member = members[model];
      member.total[item.severity]++;
      member[item.disposition][item.severity]++;
      if (models.length === 1) {
        member.unique[item.severity]++;
        if (item.disposition === "applied") member.unique_applied[item.severity]++;
      }
    }
  }
  return { chair: { model: input.chair.model, dispatches: input.chair.dispatches, clusters: input.chair.clusters.length, members_reported: reported.size }, members };
}
