import type { Check, DbSnapshot, Finding, Severity } from "../types";

import { finding, isPublicRole, listAnd, qi, qrel, rolesUsableBy, sameRole, scannedTables } from "./util";

const ID = "rls-enabled-not-forced";

/**
 * RLS on, FORCE off — the table owner is exempt from its own policies.
 *
 * How much that matters is entirely a question of *who the owner is*, and the
 * severity has to follow that or the check becomes noise. "The owner" means
 * every role with the owner's privileges: Postgres decides the exemption with
 * `has_privs_of_role`, so a member of the owning role is exempt exactly as the
 * owner is.
 *
 *   - A role an untrusted caller arrives as is, or is a member of, the owner:
 *     every request made as it skips the policies. Critical.
 *   - Owner can log in, or a login role is a member of it, and it is otherwise
 *     ordinary: anything using that connection string reads the whole table.
 *     This is the case worth waking up for.
 *   - Owner cannot log in and nothing that can is a member of it: a
 *     provisioning role nothing connects as. Informational.
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
            const holdsOwner = (role: string) => rolesUsableBy(snapshot, role).has(rel.owner.toLowerCase());
            const exposedOwners = snapshot.exposedRoles.filter((role) => !isPublicRole(role) && holdsOwner(role));
            const loginMembers = snapshot.roles
                .filter((r) => r.canLogin && !sameRole(r.name, rel.owner) && holdsOwner(r.name))
                .map((r) => r.name);

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
                    `-- neither the owner nor BYPASSRLS, and keep ${qi(rel.owner)} for migrations only.\n` +
                    `ALTER TABLE ${qrel(rel.schema, rel.name)} FORCE ROW LEVEL SECURITY; -- still worth setting`;
            } else if (exposedOwners.length > 0) {
                severity = "critical";
                const members = exposedOwners.filter((role) => !sameRole(role, rel.owner));
                detail =
                    `FORCE ROW LEVEL SECURITY is not set, so the owning role ${rel.owner} is exempt ` +
                    `from every policy on this table, and Postgres extends that exemption to every ` +
                    `member of the owning role. ${listAnd(exposedOwners)} — ` +
                    `${exposedOwners.length > 1 ? "roles" : "a role"} untrusted callers arrive as — ` +
                    `${exposedOwners.length > 1 ? "are" : "is"} ` +
                    `${members.length === exposedOwners.length ? "a member of it" : "the owner or a member of it"}.`;
                impact =
                    `A caller arriving as ${listAnd(exposedOwners)} reads and writes every row of this ` +
                    `table, ignoring all policies on it.`;
                fix =
                    `ALTER TABLE ${qrel(rel.schema, rel.name)} FORCE ROW LEVEL SECURITY;` +
                    (members.length > 0
                        ? `\n-- and unless callers are meant to hold the owner's privileges:\n` +
                          members.map((role) => `REVOKE ${qi(rel.owner)} FROM ${qi(role)};`).join("\n")
                        : "");
            } else if (canLogin || loginMembers.length > 0) {
                severity = "high";
                const who = canLogin ? [rel.owner, ...loginMembers] : loginMembers;
                detail =
                    `FORCE ROW LEVEL SECURITY is not set, so the owning role ${rel.owner} is exempt ` +
                    `from every policy on this table. ` +
                    (canLogin
                        ? `${rel.owner} can log in directly, which means a connection string for it ` +
                          `bypasses all row filtering.`
                        : `${rel.owner} cannot log in, but ${listAnd(loginMembers)} can, and ` +
                          `Postgres exempts a member of the owning role exactly as it exempts the owner.`) +
                    (canLogin && loginMembers.length > 0
                        ? ` So ${loginMembers.length > 1 ? "do" : "does"} ${listAnd(loginMembers)}, ` +
                          `which can log in and ${loginMembers.length > 1 ? "are members" : "is a member"} of it.`
                        : "");
                impact =
                    `Anything connecting as ${listAnd(who)} — including an application that was handed ` +
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
