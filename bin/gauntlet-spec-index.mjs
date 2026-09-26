#!/usr/bin/env node
// Lexical search over the spec corpus. Build-on-query: refresh a per-worktree
// FTS5 cache by mtime+size, then rank with bm25 and join telemetry at output.
import { readFileSync, appendFileSync, existsSync, statSync, readdirSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { join, dirname, basename, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { parse as parseYaml } from "yaml";

const SCHEMA_VERSION = 2;
const EVIDENCE_DF_FRACTION = 0.5;
const MIN_EVIDENCE_TOKENS = 2;
const SCORE_RATIO = 0.5;
// Default banner grammar of skills/brainstorming/reference/superseding.md; a named-section
// scope or anything after `- fully` keeps the spec live.
const FULLY_BANNER = /^> \*\*Superseded by:\*\* \[.*\]\(.*\) - fully$/;
const MIN_NODE = [24, 15, 0];
const DRAFT_MARKER = "# CONTEXT DRAFT - NOT A SPEC - fully replaced at spec-writing";
const EXCLUDE_LINE = "/.pi/gauntlet/index.sqlite*";
const SKIP_DIRS = new Set([".worktrees", "node_modules", "build"]);
const HEADER = ["score", "path", "service", "title", "status", "shipped_at", "state", "files", "snippet"];
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta  (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime_ms INTEGER, size INTEGER);
  CREATE VIRTUAL TABLE IF NOT EXISTS specs USING fts5(
    path UNINDEXED, service UNINDEXED, title, goal, headings, body, state UNINDEXED,
    tokenize = 'porter unicode61');
`;

const usage = () => {
  process.stderr.write('usage: gauntlet-spec-index --query "<text>" [--limit N] [--exclude <repo-relative path>]...\n');
  process.exit(1);
};
const die = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
};

function parseArgs(argv) {
  let query;
  let limit = 10;
  const exclude = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--query" && argv[i + 1] !== undefined) query = argv[++i];
    else if (argv[i] === "--limit" && /^[1-9]\d*$/.test(argv[i + 1] ?? "")) limit = Number(argv[++i]);
    else if (argv[i] === "--exclude" && argv[i + 1] !== undefined) exclude.push(argv[++i]);
    else usage();
  }
  if (query === undefined) usage();
  return { query, limit, exclude };
}

function nodeOk() {
  const cur = process.versions.node.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (cur[i] !== MIN_NODE[i]) return cur[i] > MIN_NODE[i];
  return true;
}

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function repoRoot() {
  try {
    return git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  } catch {
    return die("gauntlet-spec-index: not inside a git repository");
  }
}

function discover(root) {
  const out = [];
  const seen = new Set();
  const collect = (relDir, service) => {
    const abs = join(root, relDir);
    let real;
    try {
      real = realpathSync(abs);
      if (!statSync(real).isDirectory()) return;
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    for (const name of readdirSync(abs).sort()) {
      if (!name.endsWith(".md")) continue;
      const rel = `${relDir}/${name}`;
      const st = statSync(join(root, rel));
      if (st.isFile()) out.push({ path: rel, service, mtime_ms: Math.trunc(st.mtimeMs), size: st.size });
    }
  };
  collect("doc/specs", "root");
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    collect(`${e.name}/doc/specs`, e.name);
  }
  return out;
}

function ensureExclude(root) {
  const rel = git(root, ["rev-parse", "--git-path", "info/exclude"]);
  const abs = isAbsolute(rel) ? rel : join(root, rel);
  const cur = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  if (cur.split("\n").includes(EXCLUDE_LINE)) return;
  mkdirSync(dirname(abs), { recursive: true });
  appendFileSync(abs, `${cur.length && !cur.endsWith("\n") ? "\n" : ""}${EXCLUDE_LINE}\n`);
}

async function openDb(root) {
  const { DatabaseSync } = await import("node:sqlite");
  const dbPath = join(root, ".pi/gauntlet/index.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  const fresh = !existsSync(dbPath);
  const create = () => {
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA busy_timeout = 2000");
    try {
      db.exec(SCHEMA);
    } catch (e) {
      if (/fts5/i.test(e.message)) die("gauntlet-spec-index: this Node's SQLite has no FTS5 module");
      throw e;
    }
    db.prepare("INSERT OR REPLACE INTO meta VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    return db;
  };
  const rebuild = (db) => {
    try { db?.close(); } catch {}
    for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
    return create();
  };
  if (fresh) ensureExclude(root);
  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA busy_timeout = 2000");
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    if (Number(row?.value) !== SCHEMA_VERSION) return rebuild(db);
    return db;
  } catch (e) {
    const missingMeta = e?.code === "ERR_SQLITE_ERROR" && e.errcode === 1 && /no such table:\s*meta/i.test(e.message);
    const corrupt = e?.code === "ERR_SQLITE_ERROR" && (e.errcode === 11 || e.errcode === 26);
    if (missingMeta || corrupt) return rebuild(db);
    try { db?.close(); } catch {}
    throw e;
  }
}

function extract(text, path) {
  const lines = text.split(/\r?\n/);
  const h1 = lines.findIndex((l) => l.startsWith("# "));
  const title = (h1 >= 0 ? lines[h1].slice(2).trim() : "") || basename(path, ".md");
  const goal = lines.find((l) => l.startsWith("**Goal:**"))?.slice("**Goal:**".length).trim() ?? "";
  const headings = lines.filter((l) => /^##{1,2} /.test(l)).map((l) => l.replace(/^#+ /, "")).join("\n");
  let state = "live";
  if (h1 >= 0) {
    // Title block: everything after the H1 up to the first H2 heading or code fence.
    for (const l of lines.slice(h1 + 1)) {
      if (/^## /.test(l) || /^\s*(`{3,}|~{3,})/.test(l)) break;
      if (FULLY_BANNER.test(l)) { state = "superseded"; break; }
    }
  }
  return { title, goal, headings, state };
}

function refresh(db, root, corpus) {
  const known = new Map(db.prepare("SELECT path, mtime_ms, size FROM files").all().map((r) => [r.path, r]));
  const present = new Set(corpus.map((f) => f.path));
  const delSpec = db.prepare("DELETE FROM specs WHERE path = ?");
  const delFile = db.prepare("DELETE FROM files WHERE path = ?");
  const insSpec = db.prepare("INSERT INTO specs (path, service, title, goal, headings, body, state) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const putFile = db.prepare("INSERT OR REPLACE INTO files (path, mtime_ms, size) VALUES (?, ?, ?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const path of known.keys()) if (!present.has(path)) { delSpec.run(path); delFile.run(path); }
    for (const f of corpus) {
      const k = known.get(f.path);
      if (k && k.mtime_ms === f.mtime_ms && k.size === f.size) continue;
      const text = readFileSync(join(root, f.path), "utf8");
      delSpec.run(f.path);
      if (text.split(/\r?\n/, 1)[0] === DRAFT_MARKER) { delFile.run(f.path); continue; }
      const x = extract(text, f.path);
      insSpec.run(f.path, f.service, x.title, x.goal, x.headings, text, x.state);
      putFile.run(f.path, f.mtime_ms, f.size);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const tokens = (query) => query.split(/[^\p{L}\p{N}\p{Co}]+/u).filter((t) => t.length >= 2);
const quote = (t) => `"${t.replaceAll('"', '""')}"`;
const toMatch = (toks) => toks.map(quote).join(" OR ");

// Porter is not idempotent (manatee -> manate -> manat), so MATCH always receives an
// original token; the vocab pass only decides which tokens are the same term.
function representatives(db, toks) {
  const mem = new db.constructor(":memory:");
  try {
    mem.exec("CREATE VIRTUAL TABLE q USING fts5(t, tokenize = 'porter unicode61'); CREATE VIRTUAL TABLE qi USING fts5vocab(q, 'instance')");
    const ins = mem.prepare("INSERT INTO q (rowid, t) VALUES (?, ?)");
    toks.forEach((t, i) => ins.run(i + 1, t));
    const rep = new Map();
    for (const r of mem.prepare("SELECT term, doc FROM qi ORDER BY doc, offset").all()) if (!rep.has(r.term)) rep.set(r.term, toks[r.doc - 1]);
    return rep;
  } finally {
    mem.close();
  }
}

function confidenceFilter(rows, evidence) {
  return rows.filter((r) => {
    const hits = evidence.filter((e) => e.all.has(r.rowid)).length;
    const titleGoal = evidence.filter((e) => e.titleGoal.has(r.rowid)).length;
    return hits >= MIN_EVIDENCE_TOKENS && titleGoal >= MIN_EVIDENCE_TOKENS;
  });
}

function query(db, toks, { limit, exclude }) {
  const n = db.prepare("SELECT count(*) AS n FROM specs").get().n;
  const rowids = (match) => new Set(db.prepare("SELECT rowid FROM specs WHERE specs MATCH ?").all(match).map((r) => r.rowid));
  const reps = representatives(db, toks);
  const terms = [...new Set(reps.values())];
  const evidence = [];
  for (const tok of terms) {
    const all = rowids(quote(tok));
    if (all.size === 0 || all.size >= n * EVIDENCE_DF_FRACTION) continue;
    evidence.push({ all, titleGoal: rowids(`title:${quote(tok)} OR goal:${quote(tok)}`) });
  }
  if (evidence.length < MIN_EVIDENCE_TOKENS) return [];
  const rows = db.prepare(
    `SELECT rowid, path, service, title, state,
            bm25(specs, 0, 0, 10.0, 5.0, 2.0, 1.0, 0) AS score,
            snippet(specs, 5, '', '', '...', 12) AS snippet
     FROM specs WHERE specs MATCH ?`,
  ).all(toMatch(terms)).filter((r) => !exclude.includes(r.path));
  const kept = confidenceFilter(rows, evidence);
  kept.sort((a, b) => (a.state !== "live") - (b.state !== "live") || a.score - b.score);
  const best = kept.find((r) => r.state === "live");
  const cut = best ? kept.filter((r) => Math.abs(r.score) >= SCORE_RATIO * Math.abs(best.score)) : kept;
  return cut.slice(0, limit);
}

function telemetry(root, specPath) {
  const blank = { status: null, shipped_at: null, files: "" };
  const p = join(root, ".pi/gauntlet/telemetry", specPath.replace(/\.md$/, ".yaml"));
  if (!existsSync(p)) return blank;
  let rec;
  try {
    rec = parseYaml(readFileSync(p, "utf8"));
  } catch {
    process.stderr.write(`gauntlet-spec-index: warning: unreadable telemetry ${p}\n`);
    return blank;
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return blank;
  const mf = rec.derived?.modified_files;
  const files = Array.isArray(mf)
    ? mf.filter((f) => typeof f === "string" && existsSync(join(root, f))).join(";")
    : "missing";
  return { status: rec.status ?? null, shipped_at: rec.shipped_at ?? null, files };
}

const cell = (v) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
// Paths keep their spaces; only column and row delimiters are neutralised.
const filesCell = (v) => v.replace(/[\t\r\n]+/g, " ");

async function main() {
  if (!nodeOk()) die(`gauntlet-spec-index needs Node >=24.15.0 (found ${process.versions.node})`);
  const { query: text, limit, exclude } = parseArgs(process.argv.slice(2));
  const toks = tokens(text);
  if (!toks.length) usage();
  const root = repoRoot();
  const db = await openDb(root);
  refresh(db, root, discover(root));
  const rows = query(db, toks, { limit, exclude });
  const out = [HEADER.join("\t")];
  for (const r of rows) {
    const t = telemetry(root, r.path);
    out.push([...[r.score.toFixed(3), r.path, r.service, r.title, t.status, t.shipped_at, r.state].map(cell), filesCell(t.files), cell(r.snippet)].join("\t"));
  }
  process.stdout.write(out.join("\n") + "\n");
  db.close();
}

main().catch((e) => {
  if (e?.code === "ERR_SQLITE_ERROR") die(`gauntlet-spec-index: ${e.message}`);
  throw e;
});
