import type { PolicyExpression, PostgresPolicy, SecurityOperation, SecurityRule, SecurityRuleBase } from "@rebasepro/types";
import { getPolicyNamesForRule, getPolicyOperations } from "@rebasepro/utils";

/**
 * The security-rule fields a {@link PostgresPolicy} describes, and the ones an
 * edit carries over from the rule it changes.
 *
 * Wider than any one `SecurityRule` variant on purpose: a policy with only a
 * `WITH CHECK` clause — every INSERT-only policy — carries `withCheck` and no
 * `using`, which the raw-SQL variant does not admit but the generator compiles
 * exactly as written.
 */
export type PolicyRule = SecurityRuleBase & {
    using?: string;
    withCheck?: string;
    ownerField?: string;
    access?: "public";
    condition?: PolicyExpression;
    check?: PolicyExpression;
};

/**
 * A policy's `TO` list as `SecurityRule.pgRoles`.
 *
 * The `TO` list names *database* roles, and so does `pgRoles`; `roles` holds
 * *application* roles, which the generator compiles into a `rebase.roles()`
 * check in the USING clause. Filing one as the other produces a policy no user
 * can satisfy — or, on a restrictive policy, one every user passes, because
 * restrictive compiles to `NOT (roles) OR condition`.
 *
 * Omitted at the default so a rule that targets `public` — nearly all of them —
 * does not carry an advanced field it does not need.
 */
export function toPgRoles(roles: readonly string[] | undefined): string[] | undefined {
    if (!roles || roles.length === 0) return undefined;
    if (roles.length === 1 && roles[0] === "public") return undefined;
    return [...roles];
}

/**
 * The rule a policy — a `pg_policies` row, or what the policy editor produced —
 * compiles back from.
 *
 * One definition for both of the editor's writers, "Save" and "Import to
 * codebase". They used to build the rule inline, each its own way, and only
 * one of them had learned that the `TO` list is `pgRoles`.
 */
export function policyToRule(policy: Partial<PostgresPolicy>): PolicyRule {
    const pgRoles = toPgRoles(policy.roles);
    return {
        name: policy.policyname,
        operation: toSecurityOperation(policy.cmd),
        mode: toSecurityMode(policy.permissive),
        using: policy.qual || undefined,
        withCheck: policy.with_check || undefined,
        ...(pgRoles ? { pgRoles } : {})
    };
}

/** Why an edited policy could not be written back to a rule. */
export type PolicyEditRefusal =
    /** Rebase adds it (the admin baseline, tenancy); no declared rule holds it. */
    | "generated"
    /** It exists only in the database. */
    | "not_declared"
    /** Its rule covers several operations, and the policy is one of them. */
    | "several_operations";

export type PolicyEdit =
    | { ok: true; rules: PolicyRule[] }
    | { ok: false; reason: PolicyEditRefusal };

/**
 * Write an edit of one policy back to the declared rule it compiles from.
 *
 * The rule is found by the policy names it compiles to, not by `rule.name`:
 * an unnamed rule's policy is `<table>_<op>_<hash>`, and a rule over several
 * operations names each `<name>_<op>`. Matching on `name` missed both, saved
 * the rules unchanged and reported success.
 *
 * A rule over several operations is refused rather than split: taking one
 * operation out renames every policy the rule compiles to.
 *
 * @param declared  The collection's `securityRules`, as written.
 * @param effective Every rule the generator compiles for the table — the
 *                  declared ones plus what Rebase adds — to tell a generated
 *                  policy from one that exists only in the database.
 */
export function applyPolicyEdit(
    declared: readonly SecurityRule[],
    effective: readonly SecurityRule[],
    tableName: string,
    original: PostgresPolicy,
    edited: Partial<PostgresPolicy>
): PolicyEdit {
    const compilesTo = (rule: SecurityRule) => getPolicyNamesForRule(rule, tableName).includes(original.policyname);

    const index = declared.findIndex(compilesTo);
    if (index === -1) {
        return { ok: false, reason: effective.some(compilesTo) ? "generated" : "not_declared" };
    }
    const rule = declared[index];
    if (getPolicyOperations(rule).length > 1) return { ok: false, reason: "several_operations" };

    return {
        ok: true,
        rules: declared.map((r, i) => (i === index ? editedRule(r, original, edited) : r))
    };
}

/**
 * The rule with what the editor changed, and nothing else.
 *
 * The editor shows a rule as a policy — name, command, mode, `TO` list and raw
 * USING / WITH CHECK — and an `ownerField` or `access` rule has no raw clause
 * to show. So a field is only written when it differs from what the editor was
 * opened with: renaming an `access: "public"` rule keeps it public, and an
 * unnamed rule stays unnamed unless the name was changed. A condition typed in
 * replaces the rule's condition whole — the forms are exclusive.
 */
function editedRule(rule: SecurityRule, original: PostgresPolicy, edited: Partial<PostgresPolicy>): PolicyRule {
    const next = policyToRule(edited);
    const result: PolicyRule = { ...rule };

    if ((edited.policyname ?? "") !== original.policyname) {
        if (next.name) result.name = next.name;
        else delete result.name;
    }
    if (edited.cmd !== original.cmd) {
        delete result.operations;
        result.operation = next.operation;
    }
    if (edited.permissive !== original.permissive) {
        result.mode = next.mode;
    }
    if (!sameRoles(edited.roles, original.roles)) {
        if (next.pgRoles) result.pgRoles = next.pgRoles;
        else delete result.pgRoles;
    }
    if ((edited.qual || null) !== (original.qual || null) || (edited.with_check || null) !== (original.with_check || null)) {
        delete result.ownerField;
        delete result.access;
        delete result.condition;
        delete result.check;
        delete result.using;
        delete result.withCheck;
        if (next.using) result.using = next.using;
        if (next.withCheck) result.withCheck = next.withCheck;
    }
    return result;
}

function sameRoles(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    const left = [...(a ?? [])].sort();
    const right = [...(b ?? [])].sort();
    return left.length === right.length && left.every((role, i) => role === right[i]);
}

function toSecurityOperation(cmd: PostgresPolicy["cmd"] | undefined): SecurityOperation | undefined {
    switch (cmd) {
        case "SELECT": return "select";
        case "INSERT": return "insert";
        case "UPDATE": return "update";
        case "DELETE": return "delete";
        case "ALL": return "all";
        default: return undefined;
    }
}

function toSecurityMode(permissive: PostgresPolicy["permissive"] | undefined): SecurityRuleBase["mode"] {
    switch (permissive) {
        case "PERMISSIVE": return "permissive";
        case "RESTRICTIVE": return "restrictive";
        default: return undefined;
    }
}
