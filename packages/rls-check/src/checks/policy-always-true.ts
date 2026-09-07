import type { Check, DbPolicy, DbSnapshot, Finding, Severity } from "../types";

import { isUnconditionalTrue } from "./sql";
import {
    callerIdCall,
    finding,
    isRebaseManagedPolicy,
    listAnd,
    managedPolicyFix,
    policyTargetsExposedRole,
    qi,
    qrel,
    relationAt,
    rowsPhrase
} from "./util";

const ID = "policy-always-true";

/**
 * A PERMISSIVE policy whose expression is a constant truth, targeted at a role
 * an untrusted caller reaches.
 *
 * Matching is structural rather than textual — see {@link isUnconditionalTrue}.
 * `USING (true)` is flagged; `USING (is_public = true)` is not, and a
 * substring-matching version of this check would flag both.
 *
 * The one thing that legitimately rescues `USING (true)` is a RESTRICTIVE
 * policy on the same command, because RESTRICTIVE clauses are ANDed after the
 * PERMISSIVE ones are ORed. "Permissive default, restrictive gate" is a real
 * pattern, so when one is present the finding degrades to a question instead of
 * an accusation rather than disappearing (the restrictive policy may well not
 * cover the same rows).
 */
export const policyAlwaysTrue: Check = {
    id: ID,
    title: "Policy grants unconditional access",
    description: "A permissive policy whose USING or WITH CHECK expression is always true.",

    run(snapshot: DbSnapshot): Finding[] {
        const uidCall = callerIdCall(snapshot);
        const findings: Finding[] = [];

        for (const policy of snapshot.policies) {
            if (!snapshot.schemas.includes(policy.schema)) continue;
            if (!policy.permissive) continue;

            const exposed = policyTargetsExposedRole(snapshot, policy);
            if (exposed.length === 0) continue;

            const clauses: string[] = [];
            if (isUnconditionalTrue(policy.using)) clauses.push("USING");
            if (isUnconditionalTrue(policy.withCheck)) clauses.push("WITH CHECK");
            if (clauses.length === 0) continue;

            const gate = restrictiveGate(snapshot, policy);
            const rel = relationAt(snapshot, policy.schema, policy.table);
            const verb = policy.command === "SELECT" ? "read" : "act on";
            const severity: Severity = gate ? "medium" : "critical";

            findings.push(
                finding({
                    id: ID,
                    severity,
                    confidence: gate ? "heuristic" : "certain",
                    title:
                        `Policy "${policy.name}" on ${policy.schema}.${policy.table} is ` +
                        `${listAnd(clauses)} (true) for ${listAnd(exposed)}`,
                    target: { schema: policy.schema, table: policy.table, policy: policy.name },
                    detail:
                        `This permissive ${policy.command} policy's ${listAnd(clauses)} expression is a ` +
                        `constant truth, so it matches every row for ${listAnd(exposed)}. Permissive ` +
                        `policies are ORed together, so this one alone satisfies the table's row filter ` +
                        `no matter how strict the others are.` +
                        (gate
                            ? ` A RESTRICTIVE policy ("${gate}") also applies to this command and is ANDed ` +
                              `after it, so access may still be gated — verify that restrictive policy ` +
                              `covers the rows and roles you expect, because nothing else here does.`
                            : ""),
                    impact: gate
                        ? `Row filtering on this table rests entirely on the RESTRICTIVE policy "${gate}". ` +
                          `If it does not cover a case, ${listAnd(exposed)} can ${verb} every row${rowsPhrase(rel)}.`
                        : `If this table is reachable over an API as ${listAnd(exposed)}, a caller can ` +
                          `${verb} every row${rowsPhrase(rel)} — the policy applies no scoping whatsoever.`,
                    fix: isRebaseManagedPolicy(snapshot, policy)
                        ? managedPolicyFix(
                            policy,
                            `replace the rule that grants unconditional ${policy.command === "SELECT" ? "reads" : "access"} ` +
                            `with one that scopes the rows — \`ownerField\`, \`roles\`, or a \`condition\``
                        )
                        : `-- Replace the constant with the scoping you intended, e.g.:\n` +
                        `ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}\n` +
                        `    ${clauses.includes("USING") ? `USING (user_id = ${uidCall})` : `WITH CHECK (user_id = ${uidCall})`};\n` +
                        `-- or, if unconditional access really is intended, drop the policy and say so\n` +
                        `-- with an explicit grant instead:\n` +
                        `-- DROP POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)};`
                })
            );
        }

        return findings;
    }
};

/** Name of a RESTRICTIVE policy that is ANDed with this one, if any. */
function restrictiveGate(snapshot: DbSnapshot, policy: DbPolicy): string | null {
    const overlapping = snapshot.policies.find(
        (p) =>
            !p.permissive &&
            p.schema === policy.schema &&
            p.table === policy.table &&
            (p.command === "ALL" || policy.command === "ALL" || p.command === policy.command)
    );
    return overlapping?.name ?? null;
}
