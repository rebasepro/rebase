import type { Check, DbPolicy, DbSnapshot, Finding, Severity } from "../types";

import { isUnconditionalTrue } from "./sql";
import {
    callerIdCall,
    finding,
    isPublicRole,
    isRebaseManagedPolicy,
    listAnd,
    managedPolicyFix,
    policyTargetsExposedRole,
    qi,
    qrel,
    relationAt,
    rolesUsableBy,
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
 * policy on the same command that applies to the same callers, because
 * RESTRICTIVE clauses are ANDed after the PERMISSIVE ones are ORed. "Permissive default, restrictive gate" is a real
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

            const gates = restrictiveGate(snapshot, policy);
            const gate = gates && gates.length === 1
                ? { name: `RESTRICTIVE policy "${gates[0]}"`, verb: "applies" }
                : gates
                    ? { name: `RESTRICTIVE policies ${listAnd(gates.map((g) => `"${g}"`))}`, verb: "apply" }
                    : null;
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
                            ? ` The ${gate.name} also ${gate.verb} to this command ` +
                              `and to every role it reaches, ANDed after it, so access may still be gated — ` +
                              `verify that the restrictive side covers the rows you expect, because nothing ` +
                              `else here does.`
                            : ""),
                    impact: gate
                        ? `Row filtering on this table rests entirely on the ${gate.name}. ` +
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

/**
 * Does `policy` apply to a caller arriving as `role`?
 *
 * `PUBLIC` in `role` stands for "some role nothing else here names", which is a
 * member of nothing: only a policy TO PUBLIC applies to it.
 */
function policyAppliesTo(snapshot: DbSnapshot, policy: DbPolicy, role: string): boolean {
    if (policy.roles.some(isPublicRole)) return true;
    if (isPublicRole(role)) return false;
    const usable = rolesUsableBy(snapshot, role);
    return policy.roles.some((target) => usable.has(target.toLowerCase()));
}

/**
 * The callers a permissive policy lets in: every named exposed role it applies
 * to, or `PUBLIC` when it applies to no named one and is TO PUBLIC.
 *
 * The `PUBLIC` pseudo-caller is left out whenever a named role is there,
 * because it would otherwise demand a gate TO PUBLIC for a policy that every
 * real caller already has to pass a gate for — on Supabase, a restrictive
 * policy TO anon and authenticated covers every request the API makes.
 */
function callersOf(snapshot: DbSnapshot, policy: DbPolicy): string[] {
    const named = snapshot.exposedRoles.filter(
        (role) => !isPublicRole(role) && policyAppliesTo(snapshot, policy, role)
    );
    if (named.length > 0) return named;
    return policy.roles.some(isPublicRole) ? ["PUBLIC"] : [];
}

/**
 * The RESTRICTIVE policies that gate this one, or `null` when they do not gate
 * every caller it lets in.
 *
 * A restrictive policy is ANDed only for the roles in its own TO list and only
 * for its own command. Any restrictive policy on the table used to count, so
 * Supabase's documented MFA gate — `AS RESTRICTIVE TO authenticated` — next to
 * `USING (true) TO anon` softened the finding to medium while anon read every
 * row, and the default `--fail-on high` passed it. So a gate now has to apply
 * to every command the permissive policy covers (`ALL` needs `ALL`), and the
 * restrictive policies together have to apply to every caller it lets in.
 */
function restrictiveGate(snapshot: DbSnapshot, policy: DbPolicy): string[] | null {
    const gates = snapshot.policies.filter(
        (p) =>
            !p.permissive &&
            p.schema === policy.schema &&
            p.table === policy.table &&
            (p.command === "ALL" || p.command === policy.command)
    );
    const callers = callersOf(snapshot, policy);
    if (callers.length === 0) return null;
    const covering = gates.filter((gate) => callers.some((role) => policyAppliesTo(snapshot, gate, role)));
    const covered = callers.every((role) => covering.some((gate) => policyAppliesTo(snapshot, gate, role)));
    return covered ? covering.map((gate) => gate.name) : null;
}
