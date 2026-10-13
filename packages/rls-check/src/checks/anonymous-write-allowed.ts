import type { Check, DbPolicy, DbSnapshot, Finding, PolicyCommand } from "../types";

import { isUnconditionalTrue } from "./sql";
import { callerIdCall,
    ANONYMOUS_ROLES,
    WRITE_PRIVILEGES,
    effectivePrivileges,
    finding,
    isPublicRole,
    isRebaseManagedPolicy,
    listAnd,
    managedPolicyFix,
    qi,
    qrel,
    revokesReaching,
    rolesUsableBy,
    sameRole,
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
 * So what is reported is the narrow, certain case: the clause that decides the
 * command is constant-true, which in Postgres means "accept any row". An
 * *absent* clause is the opposite — see {@link writesAcceptingAnyRow}. Policies
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

            const open = writesAcceptingAnyRow(policy);
            const wanted = (COMMANDS_FOR[policy.command] ?? []).filter((p) => open.includes(p));
            if (wanted.length === 0) continue;

            const identities = anonymousIdentities(snapshot, policy.roles);
            if (identities.length === 0) continue;

            // Which write privileges those identities genuinely hold on the table.
            const granted = new Set<Privilege>();
            const grantedTo: string[] = [];
            let certain = false;
            for (const { role, conditional } of identities) {
                const held = effectivePrivileges(snapshot, policy.schema, policy.table, role);
                const hit = wanted.filter((p) => held.has(p));
                if (hit.length === 0) continue;
                hit.forEach((p) => granted.add(p));
                grantedTo.push(isPublicRole(role) ? "PUBLIC" : role);
                if (!conditional) certain = true;
            }
            if (granted.size === 0) continue;

            const commands = WRITE_PRIVILEGES.filter((p) => granted.has(p));
            const verbs = commands.map((c) => c.toLowerCase());

            findings.push(
                finding({
                    id: ID,
                    severity: "high",
                    // Only `rebase_user` reached it: whether a signed-out caller
                    // arrives as that role is the deployment's switch, which the
                    // catalog does not hold.
                    confidence: certain ? "certain" : "heuristic",
                    title:
                        `${policy.schema}.${policy.table} accepts unauthenticated ` +
                        `${listAnd(verbs)} via policy "${policy.name}"`,
                    target: { schema: policy.schema, table: policy.table, policy: policy.name },
                    detail:
                        `Policy "${policy.name}" is a permissive ${policy.command} policy for ` +
                        `${listAnd(grantedTo)}, and the expression that decides ` +
                        `${listAnd(commands)} is a constant truth, so every row satisfies it. ` +
                        `${listAnd(grantedTo)} also ${grantedTo.length > 1 ? "hold" : "holds"} ` +
                        `${listAnd(commands)} on the table, so both the privilege check and the row ` +
                        `check pass for a request that carries no credentials.` +
                        (certain
                            ? ""
                            : ` On Rebase every request runs as ${REBASE_REQUEST_ROLE} — a signed-out one ` +
                              `too when the API admits it (\`AUTH_REQUIRE=false\`, or \`auth.requireAuth: false\`), ` +
                              `and every guest account from anonymous sign-in. The database cannot see that ` +
                              `switch, so this is heuristic: with the API gate on and guests off, only ` +
                              `signed-in users reach the policy — and they can still ${listAnd(verbs)} any row.`),
                    impact:
                        `An unauthenticated caller reaching this database over an API can ` +
                        `${listAnd(verbs)} rows in ${policy.schema}.${policy.table} at will — inserting ` +
                        `records attributed to other users, or ` +
                        `${commands.includes("DELETE") ? "deleting the table's contents" : "modifying rows they do not own"}.`,
                    fix: isRebaseManagedPolicy(snapshot, policy)
                        ? managedPolicyFix(
                            policy,
                            `scope the write rule to the caller (an \`ownerField\`) or restrict it to \`roles\` — ` +
                            `and if anonymous writes are never intended, say so there rather than by ` +
                            `revoking the grant, which boot re-makes`
                        )
                        : `-- Scope the write to the caller, or take the privilege away entirely:\n` +
                        `ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}\n` +
                        `    WITH CHECK (user_id = ${uidCall});\n` +
                        `-- and if anonymous writes are never intended:\n` +
                        revokesReaching(snapshot, policy.schema, policy.table, grantedTo, commands).join("\n")
                })
            );
        }

        return findings;
    }
};

/** The role a Rebase app runs every request as, signed-in or not. */
const REBASE_REQUEST_ROLE = "rebase_user";

interface AnonymousIdentity {
    role: string;
    /**
     * Anonymous only when the deployment admits signed-out callers — Rebase's
     * `rebase_user`, which the API gate decides about, not the database.
     */
    conditional: boolean;
}

/**
 * Which unauthenticated identities a policy's TO list actually covers.
 *
 * `TO public` is not itself a role a request arrives as — it means "every role",
 * so the privileges that matter are the ones held by whichever anonymous roles
 * this database has (plus anything granted to PUBLIC). Resolving that is the
 * difference between catching `TO public` + `GRANT … TO anon` and missing it.
 *
 * A named role covers an anonymous one that is a member of it: `TO app_writer`
 * applies to `anon` when anon inherits app_writer, which a comparison of names
 * missed. And on Rebase, which has no `anon`, the role a signed-out request
 * runs as is `rebase_user` — so a Rebase database used to scan clean here
 * whatever its write policies said.
 */
function anonymousIdentities(snapshot: DbSnapshot, policyRoles: string[]): AnonymousIdentity[] {
    const present = snapshot.roles.map((r) => r.name);
    const anonymous = present.filter((name) => ANONYMOUS_ROLES.includes(name.toLowerCase()) && !isPublicRole(name));
    const rebaseRequest = snapshot.platform === "rebase"
        ? present.filter((name) => sameRole(name, REBASE_REQUEST_ROLE))
        : [];

    const out = new Map<string, AnonymousIdentity>();
    const add = (role: string, conditional: boolean) => {
        const key = role.toLowerCase();
        const seen = out.get(key);
        if (!seen || (seen.conditional && !conditional)) out.set(key, { role, conditional });
    };
    const covers = (member: string, target: string) =>
        sameRole(member, target) || rolesUsableBy(snapshot, member).has(target.toLowerCase());

    for (const target of policyRoles) {
        if (isPublicRole(target)) {
            add("public", false);
            anonymous.forEach((r) => add(r, false));
            rebaseRequest.forEach((r) => add(r, true));
            continue;
        }
        if (ANONYMOUS_ROLES.includes(target.toLowerCase())) add(target, false);
        anonymous.filter((r) => covers(r, target)).forEach((r) => add(r, false));
        rebaseRequest.filter((r) => covers(r, target)).forEach((r) => add(r, true));
    }

    return [...out.values()];
}

/**
 * The writes this policy admits for any row whatsoever.
 *
 * Postgres ORs together the expressions the permissive policies for a command
 * *have*, and denies when there are none — so a clause a policy lacks admits
 * nothing, it does not admit everything. Reading an absent clause as true
 * reported `FOR INSERT TO anon` with no WITH CHECK (the insert is refused),
 * `FOR DELETE TO anon` with no USING (no row is deleted) and `FOR UPDATE TO anon
 * WITH CHECK (true)` with no USING (no row is reached) as open writes.
 *
 *   - INSERT is decided by WITH CHECK (USING is not allowed on an INSERT policy,
 *     and a `FOR ALL` policy's USING stands in for a missing WITH CHECK);
 *   - UPDATE needs USING to reach the row and the check — WITH CHECK, or USING
 *     again — to accept the new one;
 *   - DELETE is decided by USING.
 */
function writesAcceptingAnyRow(policy: DbPolicy): Privilege[] {
    const using = policy.using != null && isUnconditionalTrue(policy.using);
    const checkExpr = policy.withCheck ?? policy.using;
    const check = checkExpr != null && isUnconditionalTrue(checkExpr);

    const out: Privilege[] = [];
    if (check) out.push("INSERT");
    if (using && check) out.push("UPDATE");
    if (using) out.push("DELETE");
    return out;
}
