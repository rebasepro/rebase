import type { Check, DbPolicy, DbSnapshot, Finding, PolicyCommand } from "../types";

import { isUnconditionalTrue } from "./sql";
import { callerIdCall,
    ANONYMOUS_ROLES,
    WRITE_PRIVILEGES,
    effectivePrivileges,
    finding,
    isPublicRole,
    listAnd,
    qi,
    qrel,
    type Privilege
} from "./util";

const ID = "anonymous-write-allowed";

const COMMANDS_FOR: Record<PolicyCommand, Privilege[]> = {
    ALL: ["INSERT", "UPDATE", "DELETE"],
    INSERT: ["INSERT"],
    UPDATE: ["UPDATE"],
    DELETE: ["DELETE"],
    SELECT: []
};

/**
 * A write policy that lets an unauthenticated caller through, backed by a real grant.
 *
 * Two conditions beyond "the policy targets anon" carry this check, and both are
 * there to stop it firing on correct configurations:
 *
 *   1. The role must actually hold the matching write privilege. Postgres checks
 *      the grant first; a policy that permits an INSERT nobody may attempt is inert.
 *   2. The policy's own expression must not scope the row. Supabase ships
 *      `anon`/`authenticated` with broad table grants by default, so a policy
 *      `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` — a textbook
 *      correct one — satisfies condition 1 on almost every project out there.
 *      Flagging it would make this check fire on the whole ecosystem.
 *
 * So what is reported is the narrow, certain case: the check expression is
 * absent or constant-true, which in Postgres means "accept any row". Policies
 * whose expression is an anonymous *tautology* rather than a constant are the
 * business of `policy-anonymous-tautology`, which can weigh the platform.
 */
export const anonymousWriteAllowed: Check = {
    id: ID,
    title: "Unauthenticated callers can write",
    description:
        "A permissive INSERT/UPDATE/DELETE policy reachable without authentication whose check " +
        "expression accepts any row, backed by a matching grant.",

    run(snapshot: DbSnapshot): Finding[] {
        const uidCall = callerIdCall(snapshot);
        const findings: Finding[] = [];

        for (const policy of snapshot.policies) {
            if (!snapshot.schemas.includes(policy.schema)) continue;
            if (!policy.permissive) continue;

            const wanted = COMMANDS_FOR[policy.command] ?? [];
            if (wanted.length === 0) continue;

            const identities = anonymousIdentities(snapshot, policy.roles);
            if (identities.length === 0) continue;

            if (!acceptsAnyRow(policy)) continue;

            // Which write privileges those identities genuinely hold on the table.
            const granted = new Set<Privilege>();
            const grantedTo: string[] = [];
            for (const role of identities) {
                const held = effectivePrivileges(snapshot, policy.schema, policy.table, role);
                const hit = wanted.filter((p) => held.has(p));
                if (hit.length === 0) continue;
                hit.forEach((p) => granted.add(p));
                grantedTo.push(isPublicRole(role) ? "PUBLIC" : role);
            }
            if (granted.size === 0) continue;

            const commands = WRITE_PRIVILEGES.filter((p) => granted.has(p));
            const verbs = commands.map((c) => c.toLowerCase());

            findings.push(
                finding({
                    id: ID,
                    severity: "high",
                    confidence: "certain",
                    title:
                        `${policy.schema}.${policy.table} accepts unauthenticated ` +
                        `${listAnd(verbs)} via policy "${policy.name}"`,
                    target: { schema: policy.schema, table: policy.table, policy: policy.name },
                    detail:
                        `Policy "${policy.name}" is a permissive ${policy.command} policy for ` +
                        `${listAnd(grantedTo)}, and its check expression ` +
                        `${policy.using == null && policy.withCheck == null
                            ? "is absent, which Postgres treats as accepting every row"
                            : "is a constant truth, so every row satisfies it"}. ` +
                        `${listAnd(grantedTo)} also ${grantedTo.length > 1 ? "hold" : "holds"} ` +
                        `${listAnd(commands)} on the table, so both the privilege check and the row ` +
                        `check pass for a request that carries no credentials.`,
                    impact:
                        `An unauthenticated caller reaching this database over an API can ` +
                        `${listAnd(verbs)} rows in ${policy.schema}.${policy.table} at will — inserting ` +
                        `records attributed to other users, or ` +
                        `${commands.includes("DELETE") ? "deleting the table's contents" : "modifying rows they do not own"}.`,
                    fix:
                        `-- Scope the write to the caller, or take the privilege away entirely:\n` +
                        `ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}\n` +
                        `    WITH CHECK (user_id = ${uidCall});\n` +
                        `-- and if anonymous writes are never intended:\n` +
                        `REVOKE ${commands.join(", ")} ON ${qrel(policy.schema, policy.table)} FROM ${grantedTo
                            .map((r) => (r === "PUBLIC" ? "PUBLIC" : `"${r}"`))
                            .join(", ")};`
                })
            );
        }

        return findings;
    }
};

/**
 * Which unauthenticated identities a policy's TO list actually covers.
 *
 * `TO public` is not itself a role a request arrives as — it means "every role",
 * so the privileges that matter are the ones held by whichever anonymous roles
 * this database has (plus anything granted to PUBLIC). Resolving that is the
 * difference between catching `TO public` + `GRANT … TO anon` and missing it.
 */
function anonymousIdentities(snapshot: DbSnapshot, policyRoles: string[]): string[] {
    const named = policyRoles.filter((r) => ANONYMOUS_ROLES.includes(r.toLowerCase()));
    if (named.length === 0) return [];
    if (!named.some(isPublicRole)) return named;

    const present = snapshot.roles
        .map((r) => r.name)
        .filter((name) => ANONYMOUS_ROLES.includes(name.toLowerCase()) && !isPublicRole(name));

    return ["public", ...present];
}

/**
 * Does this policy impose no row condition at all?
 *
 * For INSERT, Postgres falls back to USING when WITH CHECK is absent, and a
 * policy with neither clause admits every row. For UPDATE/DELETE the USING
 * clause selects the rows that may be touched.
 */
function acceptsAnyRow(policy: DbPolicy): boolean {
    const clauses =
        policy.command === "INSERT"
            ? [policy.withCheck ?? policy.using]
            : [policy.using, policy.command === "DELETE" ? null : policy.withCheck];

    const present = clauses.filter((c): c is string => c != null);
    if (present.length === 0) return true;
    return present.every((c) => isUnconditionalTrue(c));
}
