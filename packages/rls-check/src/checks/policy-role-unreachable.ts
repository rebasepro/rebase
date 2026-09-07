import type { Check, DbSnapshot, Finding } from "../types";

import {
    finding,
    isPublicRole,
    isRebaseManagedPolicy,
    managedPolicyFix,
    policiesFor,
    qi,
    qrel,
    sameRole,
    scannedTables
} from "./util";

const ID = "policy-role-unreachable";

/**
 * Every policy on a table names roles that nothing can arrive as.
 *
 * The symptom is a table that reads as empty while its policies look perfectly
 * correct. It happens most often when policies are copied from Supabase
 * documentation — `TO authenticated` — onto a database where requests arrive as
 * some other role entirely. Postgres accepts the policy, it simply never
 * applies, and RLS with no *applicable* policy denies everything.
 *
 * This project's own demo database sat in exactly this state for weeks.
 *
 * Reachability is judged from `pg_auth_members`, not from what a superuser could
 * theoretically SET ROLE to. A superuser can become any role without membership,
 * so counting that would make this check unable to fire at all — and it would be
 * answering the wrong question anyway, which is "do the requests my application
 * sends land on these policies?"
 */
export const policyRoleUnreachable: Check = {
    id: ID,
    title: "Policies target roles nothing connects as",
    description:
        "Every policy on a table names roles that do not exist, cannot log in, and that no " +
        "login role inherits — so no policy ever applies and the table reads as empty.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const rel of scannedTables(snapshot)) {
            if (!rel.rlsEnabled) continue;

            const policies = policiesFor(snapshot, rel.schema, rel.name);
            if (policies.length === 0) continue; // rls-enabled-no-policies owns this

            const named = [...new Set(policies.flatMap((p) => p.roles))];
            if (named.some((role) => isReachable(snapshot, role))) continue;

            const missing = named.filter((role) => !snapshot.roles.some((r) => sameRole(r.name, role)));

            findings.push(
                finding({
                    id: ID,
                    severity: "medium",
                    confidence: "certain",
                    title:
                        `All ${policies.length} ${policies.length === 1 ? "policy" : "policies"} on ` +
                        `${rel.schema}.${rel.name} ${policies.length === 1 ? "targets" : "target"} unreachable ${named.length === 1 ? "role" : "roles"} ` +
                        `(${named.join(", ")})`,
                    target: { schema: rel.schema, table: rel.name },
                    detail:
                        `Row-level security is enabled on this table and every policy names only ` +
                        `${named.join(", ")}. ` +
                        (missing.length > 0
                            ? `${missing.join(", ")} ${missing.length === 1 ? "does" : "do"} not exist in ` +
                              `pg_roles at all. `
                            : "") +
                        `None of these roles can log in, and no login role is a member of ` +
                        `${named.length === 1 ? "it" : "any of them"}, so no session ever has these ` +
                        `policies applied. RLS with no applicable policy denies every row.`,
                    impact:
                        `Reads of this table return zero rows for every application role, and writes are ` +
                        `rejected. Nothing is exposed — the data is invisible instead, and it looks ` +
                        `identical to an empty table, which is why this usually goes unnoticed for a long ` +
                        `time. The owner (${rel.owner}) still sees everything` +
                        `${rel.rlsForced ? " unless FORCE ROW LEVEL SECURITY changes that" : ", since FORCE ROW LEVEL SECURITY is not set"}.`,
                    fix: policies.every((p) => isRebaseManagedPolicy(snapshot, p))
                        ? managedPolicyFix(
                            policies[0],
                            `name the role your requests actually arrive as in the rules' \`roles\` — ` +
                            `confirm it with \`SELECT current_user\` from the application's own connection`
                        )
                        : `-- Point the policies at the role your requests actually arrive as. Confirm it with:\n` +
                        `--     SELECT current_user;   -- run this from your application's connection\n` +
                        `ALTER POLICY ${qi(policies[0].name)} ON ${qrel(rel.schema, rel.name)} TO <that role>;\n` +
                        `-- Alternatively, if ${named[0]} is meant to be reachable, grant membership:\n` +
                        `-- GRANT ${qi(named[0])} TO <your login role>;`
                })
            );
        }

        return findings;
    }
};

function isReachable(snapshot: DbSnapshot, role: string): boolean {
    if (isPublicRole(role)) return true;

    const def = snapshot.roles.find((r) => sameRole(r.name, role));
    if (!def) return false;
    if (def.canLogin) return true;

    return snapshot.roles.some(
        (r) => r.canLogin && r.memberOf.some((m) => sameRole(m, role))
    );
}
