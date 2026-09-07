import type { Check, DbSnapshot, Finding } from "../types";

import { matchParen, tokenize } from "./sql";
import { finding, isRebaseManagedPolicy, managedPolicyFix, qi, qrel } from "./util";

const ID = "current-setting-throws";

/**
 * `current_setting('x')` in a policy, without the `missing_ok` second argument.
 *
 * With one argument the function *raises* when the setting has never been set in
 * the session — it does not return NULL. So a request that forgets to set the
 * GUC does not get denied, it gets an error, and the failure surfaces as a 500
 * rather than an empty result. Some middleware retries on 5xx, which turns a
 * missing header into a retry loop.
 *
 * Heuristic because the GUC may be guaranteed set by a connection-level `SET` or
 * a `set_config` in the same transaction, in which case one argument is fine —
 * the check cannot see the session that will run the query.
 */
export const currentSettingThrows: Check = {
    id: ID,
    title: "Policy calls current_setting() without missing_ok",
    description:
        "A policy expression calling current_setting('x') with one argument, which raises rather " +
        "than returning NULL when the setting is unset.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const policy of snapshot.policies) {
            if (!snapshot.schemas.includes(policy.schema)) continue;

            const settings = new Set<string>();
            const clauses: string[] = [];
            for (const clause of ["USING", "WITH CHECK"] as const) {
                const expr = clause === "USING" ? policy.using : policy.withCheck;
                const hits = singleArgumentSettings(expr);
                if (hits.length === 0) continue;
                clauses.push(clause);
                hits.forEach((h) => settings.add(h));
            }
            if (settings.size === 0) continue;

            const names = [...settings];

            findings.push(
                finding({
                    id: ID,
                    severity: "low",
                    confidence: "heuristic",
                    title:
                        `Policy "${policy.name}" on ${policy.schema}.${policy.table} calls ` +
                        `current_setting(${names.map((n) => `'${n}'`).join(", ")}) without missing_ok`,
                    target: { schema: policy.schema, table: policy.table, policy: policy.name },
                    detail:
                        `The ${clauses.join(" and ")} expression calls \`current_setting\` with a single ` +
                        `argument. When ${names.length === 1 ? "that setting has" : "those settings have"} ` +
                        `not been set in the session, the call raises \`unrecognized configuration ` +
                        `parameter\` instead of returning NULL — so the policy cannot evaluate to false, ` +
                        `it errors. Passing \`true\` as the second argument makes it return NULL, which ` +
                        `the policy then treats as "no match" and denies the row, as intended.`,
                    impact:
                        `A request that reaches this table without ${names.join(" / ")} set fails with a ` +
                        `database error rather than being denied. The caller sees a 500 rather than an ` +
                        `empty result, and any middleware that retries 5xx responses will retry a request ` +
                        `that can never succeed.`,
                    fix: isRebaseManagedPolicy(snapshot, policy)
                        ? managedPolicyFix(
                            policy,
                            `pass the missing_ok argument in the rule's raw SQL — \`current_setting('${names[0]}', true)\` — ` +
                            `so an unset value denies instead of raising`
                        )
                        : `-- Add the missing_ok argument so an unset value denies instead of raising:\n` +
                        `ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}\n` +
                        `    USING (tenant_id = current_setting('${names[0]}', true)::uuid);`
                })
            );
        }

        return findings;
    }
};

/** Setting names passed to a one-argument `current_setting` call. */
function singleArgumentSettings(expr: string | null | undefined): string[] {
    if (!expr) return [];
    const tokens = tokenize(expr);
    const out: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind !== "ident" || t.quoted || t.value !== "current_setting") continue;

        const open = i + 1;
        if (tokens[open]?.kind !== "punct" || tokens[open].value !== "(") continue;
        const close = matchParen(tokens, open);
        if (close === -1) continue;

        // A comma at the call's own nesting level means missing_ok was supplied.
        const argDepth = tokens[open].depth + 1;
        const hasSecondArg = tokens
            .slice(open + 1, close)
            .some((a) => a.kind === "punct" && a.value === "," && a.depth === argDepth);
        if (hasSecondArg) continue;

        const first = tokens[open + 1];
        out.push(first?.kind === "string" ? first.value.replace(/^'|'$/g, "") : "the setting");
    }

    return [...new Set(out)];
}
