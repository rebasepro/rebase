import type { BranchDiff } from "@rebasepro/types";

/**
 * `rebase db branch diff` without `--json`: what the branch changed, a line a
 * change, plain text — the CLI colours nothing it would have to strip for a
 * pipe.
 */
export function branchDiffReport(diff: BranchDiff): string[] {
    const lines: string[] = [];
    lines.push(`Branch "${diff.branch}" (${diff.branchDatabase}) against ${diff.targetDatabase}`);
    if (!diff.forkPointKnown) {
        lines.push("  ! The point the branch was made could not be read: every row that differs is counted as the branch's change.");
    }
    lines.push("");
    lines.push(diff.schema.length === 0 ? "Schema and policies: no changes" : `Schema and policies: ${diff.schema.length} change(s)`);
    for (const change of diff.schema) {
        const sign = change.change === "added" ? "+" : change.change === "dropped" ? "-" : "~";
        const what = change.name ? `${change.object} ${change.schema}.${change.table}.${change.name}` : `${change.object} ${change.schema}.${change.table}`;
        lines.push(`  ${sign} ${what}`);
    }
    lines.push("");
    lines.push(diff.data.length === 0 ? "Data: no changes" : `Data: ${diff.data.length} table(s) with changed rows`);
    for (const table of diff.data) {
        const name = table.collection ? `${table.schema}.${table.table} (${table.collection})` : `${table.schema}.${table.table}`;
        const counts = [`+${table.inserted}`, `~${table.updated}`, `-${table.deleted}`];
        if (table.conflicts > 0) counts.push(`${table.conflicts} conflict(s)`);
        if (table.targetChanges > 0) counts.push(`${table.targetChanges} changed on ${diff.targetDatabase} only, kept`);
        lines.push(`  ${name}: ${counts.join("  ")}`);
        if (table.blocked) lines.push(`    cannot be merged: ${table.blocked.message}`);
    }
    lines.push("");
    lines.push(`Fingerprint: ${diff.fingerprint}`);
    return lines;
}
