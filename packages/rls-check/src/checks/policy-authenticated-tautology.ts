import type { Check, DbSnapshot, Finding } from "../types";

import { callerIdCall, finding, listAnd, policyTargetsExposedRole, qi, qrel } from "./util";
import { callerIdOnlyClause } from "./policy-anonymous-tautology";

const ID = "policy-authenticated-tautology";

/**
 * `auth.uid() IS NOT NULL AND auth.uid() <> 'anonymous'` — and nothing else.
 *
 * This is the *corrected* form of the anonymous tautology, and correcting that
 * one is where people stop. It genuinely does exclude signed-out callers. What
 * it does not do is scope any rows: what remains is "every registered account
 * may read every row of this table", which is a different sentence from the one
 * the person writing it usually means.
 *
 * It is the shape that leaked a customer's `users` table — every email address
 * on the platform, and the columns beside them, readable by anyone who could
 * sign up, which on a product with open registration is anyone at all. The
 * scanner watched for the anonymous form and treated the sentinel guard as a
 * clean bill of health, so the policy that actually shipped passed silently.
 *
 * `high`, not `critical`: it costs an account. On a table with open
 * registration that is a formality, and the wording says so rather than
 * pretending the distinction is comforting.
 *
 * Not folded into {@link policyAnonymousTautology}: check ids appear in
 * `--skip`, in CI baselines and in people's runbooks, so two findings with
 * different fixes and different severities have to be two ids. Someone who has
 * decided their `countries` table really is world-readable should be able to
 * silence that without also silencing "signed-out callers can read it".
 */
export const policyAuthenticatedTautology: Check = {
    id: ID,
    title: "Policy admits every signed-in caller to every row",
    description:
        "A policy whose expression is only \"the caller is signed in and not anonymous\": it excludes " +
        "signed-out callers correctly and scopes no rows between accounts.",

    run(snapshot: DbSnapshot): Finding[] {
        const uidCall = callerIdCall(snapshot);
        const findings: Finding[] = [];

        for (const policy of snapshot.policies) {
            if (!snapshot.schemas.includes(policy.schema)) continue;
            if (!policy.permissive) continue;

            const exposed = policyTargetsExposedRole(snapshot, policy);
            if (exposed.length === 0) continue;

            const usingMatch = callerIdOnlyClause(policy.using);
            const checkMatch = callerIdOnlyClause(policy.withCheck);

            const clauses: string[] = [];
            if (usingMatch?.guardsSentinel) clauses.push("USING");
            if (checkMatch?.guardsSentinel) clauses.push("WITH CHECK");
            if (clauses.length === 0) continue;

            const shape = (usingMatch?.guardsSentinel ? usingMatch.shape : checkMatch?.shape) ?? "the caller id";

            findings.push(
                finding({
                    id: ID,
                    severity: "high",
                    confidence: "heuristic",
                    title:
                        `Policy "${policy.name}" on ${policy.schema}.${policy.table} admits every ` +
                        "signed-in caller to every row",
                    target: { schema: policy.schema, table: policy.table, policy: policy.name },
                    detail:
                        `The ${listAnd(clauses)} expression of this ${policy.command} policy tests that ` +
                        `${shape} exists and is not the anonymous sentinel, and tests nothing else. That ` +
                        "correctly excludes signed-out callers — and it compares nothing to a column, so " +
                        "every row of the table satisfies it equally for every account that does sign in.",
                    impact:
                        "Any user with an account reaches every row this policy covers, including rows " +
                        "belonging to other users and other tenants. Where registration is open, \"any " +
                        "user with an account\" is anybody who fills in a form. This is the shape that " +
                        "makes a `users` table — every address on the platform — readable by its own " +
                        "members.",
                    fix:
                        "-- Scope the policy to the row, rather than to the existence of a session:\n" +
                        `ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}\n` +
                        `    USING (user_id = ${uidCall});\n` +
                        "-- Or, where members of a shared group really may see each other's rows, say\n" +
                        "-- which group:\n" +
                        `--     USING (EXISTS (SELECT 1 FROM memberships m\n` +
                        `--                    WHERE m.org_id = ${policy.table}.org_id AND m.user_id = ${uidCall}));\n` +
                        "-- If the table genuinely is readable by every account, keep this policy and\n" +
                        `-- skip the finding: rls-check --skip ${ID}`
                })
            );
        }

        return findings;
    }
};
