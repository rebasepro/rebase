/**
 * The verdict of `pnpm rls:check`, as a pure function.
 *
 * `rls-scan.mts` connects to a database; this file only decides. It is split
 * out so the decision can be tested without one: the gate once exited 0 on a
 * scan that could not read the grants catalogue, and once let a new
 * `DELETE … USING (true)` through because the baseline had a SELECT entry for
 * the same table. Neither was reachable from a test while the logic lived in a
 * script that needs Postgres to run at all.
 */

/**
 * @typedef {{ id: string, severity: string, title: string,
 *   target: { schema: string, table?: string, policy?: string, view?: string, routine?: string, column?: string } }} Finding
 * @typedef {{ schema: string, table: string, name: string, command: string }} Policy
 * @typedef {{ check: string, target: string, command?: string, reason: string }} BaselineEntry
 */

/**
 * The key a finding matches the baseline on: check id, the object, and — when
 * the finding is about a policy — that policy's command. WITHOUT the policy
 * name.
 *
 * The name is left out on purpose. A generated policy's name ends in a hash of
 * the rule's own semantics (`authors_select_841c287`), so keying on it would
 * invalidate every entry the moment an unrelated rule was edited, and the fix
 * for a broken build would be "paste the new hash in" — which is how a baseline
 * stops being read.
 *
 * The command is not optional. The intent a baseline entry records is "this
 * table is publicly READABLE on purpose", and a key of check + table alone also
 * accepted every other always-true policy on that table: a generator regression
 * that compiled the admin-only write rule to `USING (true)` produced a finding
 * with exactly the baselined key, and the gate exited 0. A policy the snapshot
 * does not know gets `?`, which no entry can name, so it fails rather than
 * matching by accident.
 *
 * @param {Finding} finding
 * @param {readonly Policy[]} policies the scanned snapshot's policies
 */
export function findingKey(finding, policies) {
    const t = finding.target;
    const object = t.table
        ? `${t.schema}.${t.table}`
        : t.view
            ? `${t.schema}.${t.view}`
            : t.routine
                ? `${t.schema}.${t.routine}`
                : t.schema;
    if (!t.policy) return `${finding.id} ${object}`;

    const policy = policies.find((p) => p.schema === t.schema && p.table === t.table && p.name === t.policy);

    return `${finding.id} ${object} ${policy ? policy.command : "?"}`;
}

/** @param {BaselineEntry} entry */
export function entryKey(entry) {
    return entry.command ? `${entry.check} ${entry.target} ${entry.command}` : `${entry.check} ${entry.target}`;
}

/**
 * @template {Finding} F
 * @param {{
 *   stats: { tables: number, policies: number },
 *   findings: readonly F[],
 *   diagnostics: { degraded: readonly { what: string, error: string }[] },
 *   policies: readonly Policy[],
 *   baseline: readonly BaselineEntry[],
 *   isGating: (finding: F) => boolean,
 *   minTables: number,
 *   minPolicies: number,
 * }} input
 * @returns {{ code: 0 | 1 | 2, shortfall: string[], degraded: { what: string, error: string }[],
 *   gating: F[], unexpected: F[], stale: BaselineEntry[] }}
 */
export function verdict({ stats, findings, diagnostics, policies, baseline, isGating, minTables, minPolicies }) {
    const shortfall = [];
    if (stats.tables < minTables) shortfall.push(`${stats.tables} table(s), expected at least ${minTables}`);
    if (stats.policies < minPolicies) {
        shortfall.push(`${stats.policies} policy/policies, expected at least ${minPolicies}`);
    }

    const accepted = new Set(baseline.map(entryKey));
    const gating = findings.filter(isGating);
    const unexpected = gating.filter((finding) => !accepted.has(findingKey(finding, policies)));
    const matched = new Set(gating.map((finding) => findingKey(finding, policies)));
    const stale = baseline.filter((entry) => !matched.has(entryKey(entry)));
    const degraded = [...diagnostics.degraded];

    // Both "nothing was there to check" and "part of it could not be read" are
    // a broken pipeline, not a clean database: a check whose catalogue read
    // failed returns no findings, which is indistinguishable from finding none.
    const code = shortfall.length > 0 || degraded.length > 0 ? 2 : unexpected.length > 0 ? 1 : 0;

    return { code, shortfall, degraded, gating, unexpected, stale };
}
