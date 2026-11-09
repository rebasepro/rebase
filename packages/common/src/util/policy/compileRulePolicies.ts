import { declaredRlsPolicyShape, DEFAULT_DATA_SOURCE_KEY, REBASE_ADMIN_ROLE, RLS_IS_REQUEST_ROLE_SQL, type CollectionConfig, type PolicyExpression, type SecurityOperation, type SecurityRule } from "@rebasepro/types";
import { getPolicyNamesForRule } from "@rebasepro/utils";
import { getTableName } from "../relations";
import { securityRuleToConditions } from "./securityRuleToConditions";
import { policyToPostgres, type PolicyCompileOptions } from "./policyToPostgres";

/**
 * One Postgres policy a security rule compiles to: its name and the clauses
 * `CREATE POLICY` is given for it.
 */
export interface CompiledRulePolicy {
    name: string;
    operation: SecurityOperation;
    /** `permissive` | `restrictive`, lower-case as the rule spells it. */
    mode: "permissive" | "restrictive";
    /** The `TO` list. Sorted, `["public"]` when the rule names none. */
    roles: string[];
    /** The `USING` clause, or `null` when the operation takes none. */
    using: string | null;
    /** The `WITH CHECK` clause, or `null` when the operation takes none. */
    withCheck: string | null;
    /**
     * Set when `roles` is `["rebase_admin"]` because the compiler put it there
     * (`adminPolicies: "adminRole"`), not because the rule named it — so a
     * database where that role cannot exist may write this policy `TO public`,
     * which is exactly what it was before, and never widen a rule's own list.
     */
    adminTarget?: true;
}

/**
 * The policies one security rule compiles to — one per operation.
 *
 * The schema planner writes these into the database, and the Studio's RLS
 * editor compares the database against them; both call this, so "what the code
 * declares" has one meaning.
 *
 * The desugaring (`access` / `ownerField` / `roles` / structured condition /
 * raw SQL → `PolicyExpression`) is {@link securityRuleToConditions}, and the SQL
 * is {@link policyToPostgres}. What lives here is only the shape: which
 * operations a rule expands to, which clauses each operation takes, and the
 * deny-all fallback for a clause that compiled to nothing.
 */
export function compileRulePolicies(
    collection: CollectionConfig,
    rule: SecurityRule,
    options?: PolicyCompileOptions
): CompiledRulePolicy[] {
    const ops = rule.operations && rule.operations.length > 0 ? rule.operations : [rule.operation ?? "all"];
    const policyNames = getPolicyNamesForRule(rule, getTableName(collection));
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);
    const mode = rule.mode ?? "permissive";
    // `rls.policyTarget: "requestRole"`: a grant is for the request roles only.
    // In the compiler, not on the rule, because a policy's name hashes the rule
    // — narrowing it there would rename every policy in every database. Never on
    // a restrictive policy: it can only take access away, from everyone.
    const shape = declaredRlsPolicyShape(collection.dataSource ?? DEFAULT_DATA_SOURCE_KEY);
    const narrowed = mode === "permissive" && shape.policyTarget === "requestRole";
    const forRequestRoles = (clause: string): string => narrowed ? `(${clause}) AND ${RLS_IS_REQUEST_ROLE_SQL}` : clause;
    // A grant only the server context or an admin can pass goes `TO
    // rebase_admin`, so it is not ORed into a signed-in user's plan, where it
    // costs the owner index (see `REBASE_ADMIN_ROLE`). In the compiler for the
    // reason above: the rule, and so the policy's name, stays as written. Never
    // for a rule naming its own `pgRoles`, and never for a restrictive policy —
    // narrowing whom a restriction applies to would widen everyone else.
    const adminOnly = mode === "permissive" && !rule.pgRoles && shape.adminPolicies === "adminRole";

    return ops.map((operation, index) => {
        const needsUsing = operation !== "insert";
        const needsWithCheck = operation !== "select" && operation !== "delete";
        const forAdmins = adminOnly
            && (!needsUsing || requiresServerOrAdmin(usingExpr))
            && (!needsWithCheck || requiresServerOrAdmin(withCheckExpr));
        let using = needsUsing && usingExpr ? policyToPostgres(usingExpr, collection, options) : null;
        let withCheck = needsWithCheck && withCheckExpr ? policyToPostgres(withCheckExpr, collection, options) : null;
        // A clause that compiled to nothing denies rather than opens.
        if (!using && needsUsing) using = "false";
        if (!withCheck && needsWithCheck) withCheck = "false";
        return {
            name: policyNames[index],
            operation,
            mode,
            roles: rule.pgRoles ? [...rule.pgRoles].sort() : [forAdmins ? REBASE_ADMIN_ROLE : "public"],
            ...(forAdmins ? { adminTarget: true as const } : {}),
            using: using === null ? null : forRequestRoles(using),
            withCheck: withCheck === null ? null : forRequestRoles(withCheck)
        };
    });
}

/**
 * Whether a clause can only be true for the server context or a caller holding
 * the `admin` role — so a policy made of such clauses loses nothing by applying
 * only to the roles those requests run as. Structural and conservative: raw
 * SQL, a role list naming anything but `admin`, or a clause that could pass for
 * someone else answers `false`, and the policy stays `TO public`.
 */
export function requiresServerOrAdmin(expr: PolicyExpression | null): boolean {
    if (!expr) return false;
    switch (expr.kind) {
        case "serverContext":
            return true;
        case "rolesOverlap":
            return expr.roles.length > 0 && expr.roles.every(role => role === "admin");
        case "rolesContain":
            return expr.roles.includes("admin");
        case "and":
            return expr.operands.some(requiresServerOrAdmin);
        case "or":
            return expr.operands.length > 0 && expr.operands.every(requiresServerOrAdmin);
        default:
            return false;
    }
}
