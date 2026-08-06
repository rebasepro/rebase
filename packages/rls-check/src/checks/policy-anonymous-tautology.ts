import type { Check, DbSnapshot, Finding, Severity } from "../types";

import { callerIdCall, finding, listAnd, policyTargetsExposedRole, qi, qrel } from "./util";

const ID = "policy-anonymous-tautology";

/**
 * `auth.uid() IS NOT NULL` and its relatives.
 *
 * What this expression *means* depends entirely on the stack in front of the
 * database, and getting that wrong would fire a critical finding on essentially
 * every Supabase project in existence:
 *
 *   - Supabase: `auth.uid()` reads a JWT claim and returns NULL for an anonymous
 *     caller, so the expression is a legitimate "signed in" test. Its only real
 *     failing is that it does not scope rows to their owner — worth `low`, worded
 *     as a design observation rather than a vulnerability.
 *   - Rebase / PostgREST-style stacks that coerce a missing id to a sentinel
 *     (`'anonymous'`, `''`): the expression is true for signed-out callers, so it
 *     is a straight authentication bypass. This exact policy shipped in this
 *     project and granted anonymous access for weeks.
 *   - Anything else: it comes down to whether the stack coerces, which the
 *     database cannot tell us. `medium`, and say so out loud.
 *
 * A `<> 'anonymous'` guard alongside the null test is the corrected form and
 * clears the policy entirely.
 */
export const policyAnonymousTautology: Check = {
    id: ID,
    title: "Policy only checks that a caller id exists",
    description:
        "A policy whose expression is `auth.uid() IS NOT NULL`-shaped: it separates signed-in " +
        "from signed-out callers but scopes no rows.",

    run(snapshot: DbSnapshot): Finding[] {
        const uidCall = callerIdCall(snapshot);
        const findings: Finding[] = [];
        const { severity, meaning, impactSuffix } = platformReading(snapshot.platform);

        for (const policy of snapshot.policies) {
            if (!snapshot.schemas.includes(policy.schema)) continue;
            if (!policy.permissive) continue;

            const exposed = policyTargetsExposedRole(snapshot, policy);
            if (exposed.length === 0) continue;

            const clauses: string[] = [];
            const usingMatch = matchTautology(policy.using);
            const checkMatch = matchTautology(policy.withCheck);
            if (usingMatch) clauses.push("USING");
            if (checkMatch) clauses.push("WITH CHECK");
            if (clauses.length === 0) continue;

            const shape = usingMatch ?? checkMatch ?? "the caller id";

            findings.push(
                finding({
                    id: ID,
                    severity,
                    confidence: "heuristic",
                    title:
                        `Policy "${policy.name}" on ${policy.schema}.${policy.table} only checks ` +
                        `that ${shape} is not null`,
                    target: { schema: policy.schema, table: policy.table, policy: policy.name },
                    detail:
                        `The ${listAnd(clauses)} expression of this ${policy.command} policy tests only ` +
                        `that ${shape} is non-null. It does not compare anything to a column, so every ` +
                        `row of the table satisfies it equally — the policy distinguishes signed-in from ` +
                        `signed-out callers and nothing else. ${meaning}`,
                    impact:
                        `Any caller for whom ${shape} is non-null can reach every row this policy covers, ` +
                        `including rows belonging to other users or tenants. ${impactSuffix}`,
                    fix:
                        `-- Scope the policy to the row's owner rather than to the existence of an id:\n` +
                        `ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}\n` +
                        `    USING (user_id = ${uidCall});\n` +
                        `-- If the intent really is "any signed-in user", make that explicit and make it\n` +
                        `-- reject the anonymous sentinel your stack may use:\n` +
                        `--     USING (${uidCall} IS NOT NULL AND ${uidCall} <> 'anonymous');`
                })
            );
        }

        return findings;
    }
};

function platformReading(platform: DbSnapshot["platform"]): {
    severity: Severity;
    meaning: string;
    impactSuffix: string;
} {
    switch (platform) {
        case "supabase":
            return {
                severity: "low",
                meaning:
                    `On Supabase, \`auth.uid()\` returns NULL for an anonymous request, so this is a ` +
                    `working authenticated-only check rather than a bypass. It is listed because it ` +
                    `only distinguishes signed-in from signed-out; it does not scope rows to their owner.`,
                impactSuffix:
                    `Anonymous callers are correctly excluded on Supabase, so this is a data-scoping ` +
                    `gap between signed-in users, not an anonymous-access hole.`
            };
        case "rebase":
        case "postgrest":
            return {
                severity: "critical",
                meaning:
                    `On this stack a request without a session is given a sentinel id (an 'anonymous' ` +
                    `string rather than NULL), so this expression is true for signed-out callers too — ` +
                    `it authorises everyone.`,
                impactSuffix:
                    `Because signed-out requests arrive with a sentinel id rather than NULL, this ` +
                    `includes unauthenticated callers.`
            };
        default:
            return {
                severity: "medium",
                meaning:
                    `Whether this excludes anonymous callers depends on the layer in front of the ` +
                    `database: if it leaves the setting unset for signed-out requests the expression is ` +
                    `false and this is merely loose; if it coerces them to a sentinel id (an empty ` +
                    `string or 'anonymous') the expression is true and this authorises everyone.`,
                impactSuffix:
                    `Whether unauthenticated callers are included depends on whether your stack coerces ` +
                    `a missing caller id to a sentinel value — check that before judging the severity.`
            };
    }
}

/**
 * Both schema spellings, deliberately.
 *
 * This runs over policy bodies read back from a live database, and those outlive
 * the release that wrote them: Rebase moved its helpers from `auth` to `rebase`
 * at 1.0, so a database mid-migration holds both, and a Supabase database holds
 * `auth.*` for good. A security check that stops recognising a dangerous clause
 * because a schema was renamed is a check that silently turned itself off.
 */
const CALLER_ID_CALLS: { re: RegExp; label: (m: RegExpExecArray) => string }[] = [
    { re: /(?:rebase|auth)\.uid\s*\(\s*\)/g, label: (m) => m[0].replace(/\s+/g, "") },
    { re: /auth\.role\s*\(\s*\)/g, label: () => "auth.role()" },
    { re: /(?:rebase|auth)\.roles\s*\(\s*\)/g, label: (m) => m[0].replace(/\s+/g, "") },
    { re: /(?:rebase|auth)\.jwt\s*\(\s*\)/g, label: (m) => m[0].replace(/\s+/g, "") },
    { re: /current_setting\s*\(\s*('[^']*')\s*(?:,\s*[a-z]+\s*)?\)/g, label: (m) => `current_setting(${m[1]})` }
];

/**
 * Recognise `<caller-id expression> IS NOT NULL` and name what was tested — but
 * only when that is the *entire* expression.
 *
 * The "entire" part is what keeps this check honest. `auth.uid() IS NOT NULL AND
 * user_id = auth.uid()` contains the shape and is a perfectly scoped policy; a
 * substring match would flag it, and flagging correct Supabase policies is the
 * fastest way to get this tool deleted. So the caller-id call is substituted for
 * a placeholder, casts, parens, `SELECT` wrappers and whitespace are stripped,
 * and what remains has to be exactly `<placeholder> is not null`.
 */
function matchTautology(clause: string | null | undefined): string | null {
    if (!clause) return null;
    const flat = clause.toLowerCase().replace(/\s+/g, " ");

    // The corrected form guards against the anonymous sentinel; not this finding.
    if (/(<>|!=)\s*'anonymous'/.test(flat) || /(<>|!=)\s*''/.test(flat)) return null;

    for (const { re, label } of CALLER_ID_CALLS) {
        const first = new RegExp(re.source).exec(flat);
        if (!first) continue;

        const normalized = flat
            .replace(new RegExp(re.source, "g"), "callerid")
            .replace(/::[a-z0-9_[\]]+/g, "")
            .replace(/\bselect\b/g, "")
            // Postgres renders a wrapped call as `( SELECT rebase.uid() AS uid)`.
            .replace(/\bas [a-z0-9_]+/g, "")
            .replace(/[()\s]/g, "");

        if (normalized === "calleridisnotnull") return label(first);
    }

    return null;
}
