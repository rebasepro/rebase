import type { Check, DbSnapshot, Finding, Severity } from "../types";

import { finding, qrel, sameRole, scannedTables } from "./util";

const ID = "rls-enabled-not-forced";

/**
 * RLS on, FORCE off — the table owner is exempt from its own policies.
 *
 * How much that matters is entirely a question of *who the owner is*, and the
 * severity has to follow that or the check becomes noise:
 *
 *   - Owner cannot log in: a provisioning role nothing connects as. Informational.
 *   - Owner can log in and is otherwise ordinary: anything using that connection
 *     string reads the whole table. This is the case worth waking up for.
 *   - Owner is a superuser or has BYPASSRLS: FORCE would not help either way,
 *     because those attributes skip RLS before ownership is even considered.
 *     Reporting `high` here would be misleading — the fix is "do not connect as
 *     this role", not "set FORCE".
 */
export const rlsEnabledNotForced: Check = {
    id: ID,
    title: "RLS enabled but not forced for the table owner",
    description: "A table with RLS enabled where the owning role is exempt from its own policies.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const rel of scannedTables(snapshot)) {
            if (!rel.rlsEnabled || rel.rlsForced) continue;

            const owner = snapshot.roles.find((r) => sameRole(r.name, rel.owner));
            const bypasses = Boolean(owner?.superuser || owner?.bypassRls);
            const canLogin = Boolean(owner?.canLogin);

            let severity: Severity = "medium";
            let detail: string;
            let impact: string;
            let fix: string;

            if (bypasses) {
                severity = "medium";
                detail =
                    `Policies on this table do not apply to its owner, ${rel.owner}, because ` +
                    `FORCE ROW LEVEL SECURITY is not set. That role is additionally ` +
                    `${owner?.superuser ? "a superuser" : "marked BYPASSRLS"}, so it skips row-level ` +
                    `security on every table regardless of this setting — FORCE would not constrain it.`;
                impact =
                    `Any connection made as ${rel.owner} reads and writes every row of this table, ` +
                    `ignoring all policies. This is expected for an administrative role and dangerous ` +
                    `only if an application connects with it.`;
                fix =
                    `-- FORCE cannot constrain this role. Connect your application as a role that is\n` +
                    `-- neither the owner nor BYPASSRLS, and keep ${rel.owner} for migrations only.\n` +
                    `ALTER TABLE ${qrel(rel.schema, rel.name)} FORCE ROW LEVEL SECURITY; -- still worth setting`;
            } else if (canLogin) {
                severity = "high";
                detail =
                    `FORCE ROW LEVEL SECURITY is not set, so the owning role ${rel.owner} is exempt ` +
                    `from every policy on this table. ${rel.owner} can log in directly, which means a ` +
                    `connection string for it bypasses all row filtering.`;
                impact =
                    `Anything connecting as ${rel.owner} — including an application that was handed ` +
                    `the owner's connection string, which is the default in most quick-start setups — ` +
                    `reads and writes every row, ignoring the policies on this table.`;
                fix = `ALTER TABLE ${qrel(rel.schema, rel.name)} FORCE ROW LEVEL SECURITY;`;
            } else {
                severity = "medium";
                detail =
                    `FORCE ROW LEVEL SECURITY is not set, so the owning role ${rel.owner} is exempt ` +
                    `from every policy on this table. That role cannot log in` +
                    `${owner ? "" : " (it was not found in pg_roles, so it may have been dropped)"}, ` +
                    `so nothing connects as it directly today.`;
                impact =
                    `No caller bypasses policies through ownership right now. If ${rel.owner} is ever ` +
                    `granted LOGIN, or a role that can SET ROLE to it is used by an application, every ` +
                    `policy on this table stops applying to that session.`;
                fix = `ALTER TABLE ${qrel(rel.schema, rel.name)} FORCE ROW LEVEL SECURITY;`;
            }

            findings.push(
                finding({
                    id: ID,
                    severity,
                    confidence: "certain",
                    title: `${rel.schema}.${rel.name}: policies do not apply to its owner ${rel.owner}`,
                    target: { schema: rel.schema, table: rel.name },
                    detail,
                    impact,
                    fix
                })
            );
        }

        return findings;
    }
};
