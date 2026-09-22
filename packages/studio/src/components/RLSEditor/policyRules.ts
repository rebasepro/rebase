import type { PostgresPolicy, SecurityOperation, SecurityRuleBase } from "@rebasepro/types";

/**
 * The security-rule fields a {@link PostgresPolicy} describes.
 *
 * Wider than any one `SecurityRule` variant on purpose: a policy with only a
 * `WITH CHECK` clause — every INSERT-only policy — carries `withCheck` and no
 * `using`, which the raw-SQL variant does not admit but the generator compiles
 * exactly as written.
 */
export type PolicyRule = SecurityRuleBase & {
    using?: string;
    withCheck?: string;
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
