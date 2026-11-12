/**
 * Which fences are history, and which names history may still use.
 *
 * A changelog entry and an upgrade guide describe the API of the version they
 * were written for, and they must stay as written: rewriting 0.24's release
 * notes to today's names would make them false. The verifier checks every
 * fence against today's packages, though, so when a release removes a name,
 * every fence that once taught it — in all six locales and the six changelog
 * mirrors — turns red, and the `no-verify` budget cannot absorb them (nor
 * should it: a blanket opt-out would also stop checking the fence for every
 * other kind of drift).
 *
 * The principled reading is that a historical fence is checked against the
 * API surface of ITS version. Rather than rebuild old packages, this holds the
 * difference explicitly: `removed-in-<release>.json` lists the names a release
 * removed, generated from the banked API-surface diff (`removed-names.mjs`)
 * plus a short reviewed list of removals that surface cannot see. A fence in a
 * changelog section, or an upgrade page, for a version BEFORE that release may
 * use exactly those names — and nothing else is relaxed: an unknown name that
 * is not on the list still fails there, and every fence after the release is
 * held to today's API.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** The removal lists, newest last. One file per breaking release that removed names. */
export const REMOVED_NAME_FILES = ["removed-in-0-31.json"];

const HERE = import.meta.dirname;

/** Compare dotted versions numerically: -1, 0 or 1. */
export function compareVersions(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
}

/**
 * Read the removal lists.
 *
 * @param {string} [dir] where the JSON files live (tests pass a fixture directory)
 * @returns {Array<{ release: string, exports: Map<string, Set<string>>, names: Set<string> }>}
 *   per release: the exports removed from each package (for import checks),
 *   and every removed name — exports, members, reviewed — for diagnostics.
 */
export function loadRemovedNames(dir = HERE) {
    const out = [];
    for (const file of REMOVED_NAME_FILES) {
        const full = path.join(dir, file);
        if (!existsSync(full)) continue;
        const data = JSON.parse(readFileSync(full, "utf8"));
        const exports = new Map();
        const names = new Set();
        for (const [pkg, list] of Object.entries(data.generated?.exports ?? {})) {
            exports.set(pkg, new Set(list));
            for (const name of list) names.add(name);
        }
        for (const types of Object.values(data.generated?.members ?? {})) {
            for (const members of Object.values(types)) for (const m of members) names.add(m);
        }
        for (const entry of data.reviewed ?? []) {
            names.add(entry.name);
            if (entry.export) {
                if (!exports.has(entry.package)) exports.set(entry.package, new Set());
                exports.get(entry.package).add(entry.name);
            }
        }
        out.push({ release: data.release, exports, names });
    }
    return out;
}

const fileCache = new Map();
function linesOf(root, file) {
    let lines = fileCache.get(file);
    if (!lines) {
        lines = readFileSync(path.join(root, file), "utf8").split("\n");
        fileCache.set(file, lines);
    }
    return lines;
}

/**
 * The version a fence documents, when it is history; `null` when it is not.
 *
 * - a changelog (`CHANGELOG.md` at the root or a docs mirror): the version of
 *   the nearest `## [x.y.z]` heading above the fence. `[Unreleased]` is not
 *   history.
 * - an upgrade page `upgrading/<a>-<b>-to-<c>-<d>.mdx`: the version it upgrades
 *   TO, `<c>.<d>` — the guide describes the API on both sides of that hop.
 *
 * @param {string} root
 * @param {string} file relative to `root`
 * @param {number} line 1-based line of the fence's first body line
 */
export function historicalVersionOf(root, file, line) {
    const upgrade = /(?:^|\/)upgrading\/(\d+)-(\d+)-to-(\d+)-(\d+)\.mdx?$/.exec(file);
    if (upgrade) return `${upgrade[3]}.${upgrade[4]}`;
    if (!/(?:^|\/)CHANGELOG\.md$/.test(file)) return null;
    const lines = linesOf(root, file);
    for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
        const heading = /^## \[([^\]]+)\]/.exec(lines[i]);
        if (heading) return /^\d+\.\d+(\.\d+)?$/.test(heading[1]) ? heading[1] : null;
    }
    return null;
}

/**
 * The removal lists that apply to a fence: those of every release after the
 * version the fence documents. Empty for a fence that is not history.
 */
export function removalsFor(root, file, line, removed) {
    const version = historicalVersionOf(root, file, line);
    if (!version) return [];
    return removed.filter(r => compareVersions(version, r.release) < 0);
}

/** Whether `name`, imported from `pkg`, was removed by a release this fence predates. */
export function importIsHistorical(root, file, line, pkg, name, removed) {
    return removalsFor(root, file, line, removed).some(r => r.exports.get(pkg)?.has(name));
}

/** Whether `name` (an export or a member) was removed by a release this fence predates. */
export function nameIsHistorical(root, file, line, name, removed) {
    return removalsFor(root, file, line, removed).some(r => r.names.has(name));
}
