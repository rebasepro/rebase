/**
 * The check registry.
 *
 * Check ids are a public API: they appear in `--skip`, in CI baselines and in
 * people's documentation, so renaming one is a breaking change. Adding a check
 * is not, which is why the list is ordered by severity rather than alphabetically
 * — it is read by humans deciding what to look at first.
 */
import type { Check, DbSnapshot, Finding } from "../types";

import { anonymousWriteAllowed } from "./anonymous-write-allowed";
import { currentSettingThrows } from "./current-setting-throws";
import { grantToPublic } from "./grant-to-public";
import { junctionTableUnprotected } from "./junction-table-unprotected";
import { matviewBypassesRls } from "./matview-bypasses-rls";
import { policyAlwaysTrue } from "./policy-always-true";
import { policyAnonymousTautology } from "./policy-anonymous-tautology";
import { policyAuthenticatedTautology } from "./policy-authenticated-tautology";
import { policyRoleUnreachable } from "./policy-role-unreachable";
import { rlsDisabled } from "./rls-disabled";
import { rlsEnabledNoPolicies } from "./rls-enabled-no-policies";
import { rlsEnabledNotForced } from "./rls-enabled-not-forced";
import { securityDefinerMutableSearchPath } from "./security-definer-mutable-search-path";
import { unqualifiedColumnInSubquery } from "./unqualified-column-in-subquery";
import { viewBypassesRls } from "./view-bypasses-rls";
import { SEVERITY_ORDER, relationAt } from "./util";

export const CHECKS: Check[] = [
    rlsDisabled,
    policyAlwaysTrue,
    policyAnonymousTautology,
    policyAuthenticatedTautology,
    viewBypassesRls,
    matviewBypassesRls,
    anonymousWriteAllowed,
    unqualifiedColumnInSubquery,
    junctionTableUnprotected,
    rlsEnabledNotForced,
    rlsEnabledNoPolicies,
    policyRoleUnreachable,
    grantToPublic,
    securityDefinerMutableSearchPath,
    currentSettingThrows
];

export interface RunOptions {
    /** Run only these check ids. */
    only?: string[];
    /** Skip these check ids. */
    skip?: string[];
}

/**
 * Run every selected check and return the findings, worst first.
 *
 * Never throws. A check that blows up on some shape of catalog nobody
 * anticipated degrades to a check that found nothing — reporting thirteen
 * findings is strictly better than reporting a crash, and this is a tool people
 * point at production and expect to be inert.
 */
export function runChecks(snapshot: DbSnapshot, opts: RunOptions = {}): Finding[] {
    const only = opts.only && opts.only.length > 0 ? new Set(opts.only) : null;
    const skip = new Set(opts.skip ?? []);

    const findings: Finding[] = [];
    for (const check of CHECKS) {
        if (only && !only.has(check.id)) continue;
        if (skip.has(check.id)) continue;

        try {
            findings.push(...check.run(snapshot));
        } catch {
            // Deliberately silent: `report.ts` owns what the user sees, and a
            // check that failed produced no findings, which is what the caller
            // is told by its absence.
        }
    }

    return sortFindings(snapshot, findings);
}

/**
 * Worst first, then biggest blast radius first.
 *
 * `estimatedRows` orders equally-severe findings so the table with a million
 * rows is read before the one with four. It never influences severity — a
 * never-analyzed table reports `reltuples = -1` and would otherwise be
 * systematically buried.
 */
export function sortFindings(snapshot: DbSnapshot, findings: Finding[]): Finding[] {
    const rows = (f: Finding): number => {
        if (!f.target.table) return -1;
        return relationAt(snapshot, f.target.schema, f.target.table)?.estimatedRows ?? -1;
    };

    return [...findings].sort((a, b) => {
        const bySeverity = SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity);
        if (bySeverity !== 0) return bySeverity;

        const byRows = rows(b) - rows(a);
        if (byRows !== 0) return byRows;

        return (
            a.target.schema.localeCompare(b.target.schema) ||
            (a.target.table ?? "").localeCompare(b.target.table ?? "") ||
            a.id.localeCompare(b.id) ||
            a.title.localeCompare(b.title)
        );
    });
}
