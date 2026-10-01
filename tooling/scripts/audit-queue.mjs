#!/usr/bin/env node
/**
 * The audit queue: which system of the platform to audit next, and the gate
 * that keeps every line of source inside some system.
 *
 * Audits here were run when someone thought to ask for one, scoped to whatever
 * they asked about. Each one found a batch of problems the previous sweeps had
 * walked past, because a sweep sliced by package cannot see a system that spans
 * five of them, and because nothing said which system had changed most since
 * anyone last looked at it. `docs/audits/systems.json` names the systems and the
 * code that belongs to each; this script turns it into an ordered queue.
 *
 *   pnpm audit:queue                      ranked table, most due first
 *   pnpm audit:queue --json               the same, machine-readable
 *   pnpm audit:queue --next               the most due system, as JSON
 *   pnpm audit:queue --record <id> [--by <label>] [--commit <sha>] [--date YYYY-MM-DD]
 *                                         stamp an audit of <id> into systems.json
 *   pnpm check:audit-coverage             (= --check) the gate below
 *
 * The rank. A system never audited is first, largest first. Otherwise, for
 * the paths of the system since the commit its last audit started from:
 *
 *   score = churned lines / 100 + 3 × feat commits + 2 × fix commits + days / 7
 *
 * New features are where unaudited behaviour comes from; fixes cluster where the
 * next bug is; time alone eventually makes any system due. The weights are
 * deliberately round — the queue only has to order the systems, not measure them.
 *
 * The gate. Every tracked source file under `packages/<pkg>/src/` (tests
 * excepted) has to match a system's paths or an `unowned` entry with its
 * reason, and every path a system names has to match at least one file. The
 * first rule is what makes the queue complete without anyone remembering it: a
 * new package or directory fails CI until it is assigned, and from then on its
 * churn ranks its system. The second keeps a rename from quietly emptying a
 * system — a path that matches nothing is a system that will never look due.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY = "docs/audits/systems.json";

/** Source files the coverage rule applies to. */
const SOURCE = /^packages\/[^/]+\/src\//;
/** Test files ride along with the code they test; they are never a system of their own. */
const TEST = /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/__tests__\/)/;

/**
 * A git `:(glob)` pathspec as a RegExp over repository-relative paths: `*` and
 * `?` stay inside one segment, `**` crosses segments, and `**` before a slash
 * may match no directory at all.
 */
export function globToRegExp(glob) {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; }
                else { out += ".*"; i += 1; }
            } else out += "[^/]*";
        } else if (c === "?") out += "[^/]";
        else if (c === "[") {
            const close = glob.indexOf("]", i);
            if (close === -1) { out += "\\["; continue; }
            out += "[" + glob.slice(i + 1, close).replace(/^!/, "^") + "]";
            i = close;
        } else out += c.replace(/[.+^${}()|\\]/g, "\\$&");
    }
    return new RegExp(`^${out}$`);
}

/**
 * The coverage rule, as a pure function of the tracked file list.
 * Returns the source files no system or `unowned` entry claims, and the
 * system paths that match no file at all.
 */
export function coverage(registry, files) {
    const problems = [];
    const ids = new Set();
    for (const system of registry.systems) {
        if (ids.has(system.id)) problems.push(`system id "${system.id}" is used twice`);
        ids.add(system.id);
        if (!system.paths?.length) problems.push(`system "${system.id}" names no paths`);
        if (!system.focus) problems.push(`system "${system.id}" has no focus — the auditor would not know what to ask`);
    }
    const claims = [
        ...registry.systems.flatMap((s) => s.paths.map((p) => ({ owner: s.id, glob: p, re: globToRegExp(p) }))),
        ...(registry.unowned ?? []).map((u) => ({ owner: "unowned", glob: u.path, re: globToRegExp(u.path), why: u.why }))
    ];
    for (const u of registry.unowned ?? []) {
        if (!u.why) problems.push(`unowned "${u.path}" gives no reason — the reason is what makes it a decision rather than an omission`);
    }
    const unclaimed = files.filter((f) => SOURCE.test(f) && !TEST.test(f) && !claims.some((c) => c.re.test(f)));
    const dead = claims.filter((c) => !files.some((f) => c.re.test(f))).map((c) => `${c.owner}: ${c.glob}`);
    return { problems, unclaimed, dead };
}

/** The rank, as a pure function of each system's change statistics. */
export function score({ lines, feats, fixes, days }) {
    return lines / 100 + 3 * feats + 2 * fixes + days / 7;
}

function git(args) {
    return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024
    });
}

const pathspecs = (system) => system.paths.map((p) => `:(glob)${p}`);

function lastAudit(system) {
    const audits = system.audits ?? [];
    return audits.length ? audits[audits.length - 1] : null;
}

function stats(system, files, today) {
    const last = lastAudit(system);
    const size = files.filter((f) => system.paths.some((p) => globToRegExp(p).test(f))).length;
    if (!last) return { id: system.id, title: system.title, size, last: null, score: Infinity };
    const range = `${last.commit}..HEAD`;
    const subjects = git(["log", "--no-merges", "--format=%s", range, "--", ...pathspecs(system)])
        .split("\n").filter(Boolean);
    const shortstat = git(["diff", "--shortstat", last.commit, "HEAD", "--", ...pathspecs(system)]);
    const ins = Number(shortstat.match(/(\d+) insertion/)?.[1] ?? 0);
    const del = Number(shortstat.match(/(\d+) deletion/)?.[1] ?? 0);
    const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(last.date)) / 86_400_000));
    const s = {
        lines: ins + del,
        commits: subjects.length,
        feats: subjects.filter((m) => /^feat(\(|!|:)/.test(m)).length,
        fixes: subjects.filter((m) => /^fix(\(|!|:)/.test(m)).length,
        days
    };
    return { id: system.id, title: system.title, size, last, ...s, score: score(s) };
}

function rank(registry, files) {
    const today = new Date().toISOString().slice(0, 10);
    return registry.systems
        .map((s) => stats(s, files, today))
        .sort((a, b) => (b.score === a.score ? b.size - a.size : b.score - a.score));
}

function readRegistry() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, REGISTRY), "utf8"));
}

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
    const registry = readRegistry();
    const files = git(["ls-files"]).split("\n").filter(Boolean);
    const argv = process.argv.slice(2);

    if (argv.includes("--check")) {
        const { problems, unclaimed, dead } = coverage(registry, files);
        for (const p of problems) console.error(`✗ ${p}`);
        if (unclaimed.length) {
            console.error(`✗ ${unclaimed.length} source file(s) belong to no system in ${REGISTRY}:`);
            const dirs = [...new Set(unclaimed.map((f) => path.dirname(f)))];
            for (const d of dirs.slice(0, 40)) console.error(`    ${d}/ (${unclaimed.filter((f) => path.dirname(f) === d).length})`);
            console.error(`  Add each to the system that owns it, or to "unowned" with the reason — a file in no system is never audited.`);
        }
        if (dead.length) {
            console.error(`✗ ${dead.length} path(s) in ${REGISTRY} match no tracked file — a renamed directory has left its system:`);
            for (const d of dead) console.error(`    ${d}`);
        }
        if (problems.length || unclaimed.length || dead.length) process.exit(1);
        console.log(`✓ ${registry.systems.length} systems cover every source file under packages/*/src`);
        return;
    }

    if (argv.includes("--record")) {
        const id = arg("--record");
        const system = registry.systems.find((s) => s.id === id);
        if (!system) {
            console.error(`No system "${id}". Known: ${registry.systems.map((s) => s.id).join(", ")}`);
            process.exit(1);
        }
        const commit = git(["rev-parse", "--short=12", arg("--commit") ?? "HEAD"]).trim();
        const entry = {
            date: arg("--date") ?? new Date().toISOString().slice(0, 10),
            commit,
            by: arg("--by") ?? "manual"
        };
        system.audits = [...(system.audits ?? []), entry];
        fs.writeFileSync(path.join(ROOT, REGISTRY), JSON.stringify(registry, null, 2) + "\n");
        console.log(`Recorded ${id}: ${JSON.stringify(entry)}`);
        return;
    }

    const ranked = rank(registry, files);

    if (argv.includes("--next")) {
        const top = ranked[0];
        const system = registry.systems.find((s) => s.id === top.id);
        console.log(JSON.stringify({ ...top, score: Number.isFinite(top.score) ? top.score : "never audited", paths: system.paths, focus: system.focus }, null, 2));
        return;
    }
    if (argv.includes("--json")) {
        console.log(JSON.stringify(ranked.map((r) => ({ ...r, score: Number.isFinite(r.score) ? r.score : null })), null, 2));
        return;
    }

    const rows = ranked.map((r) => [
        r.id,
        Number.isFinite(r.score) ? r.score.toFixed(1) : "never",
        r.last ? `${r.last.date} (${r.last.by})` : "—",
        r.last ? String(r.commits) : "",
        r.last ? String(r.feats) : "",
        r.last ? String(r.fixes) : "",
        r.last ? String(r.lines) : "",
        String(r.size)
    ]);
    const head = ["system", "score", "last audit", "commits", "feat", "fix", "lines", "files"];
    const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells) => cells.map((c, i) => (i === 0 || i === 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
    console.log(line(head));
    for (const r of rows) console.log(line(r));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
