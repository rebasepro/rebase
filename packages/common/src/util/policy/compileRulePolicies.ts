import { declaredRlsPolicyShape, isRedactedSecurityRule, DEFAULT_DATA_SOURCE_KEY, REBASE_ADMIN_REQUEST_ROLE, REBASE_ADMIN_ROLE, RLS_IS_REQUEST_ROLE_SQL, type CollectionConfig, type PolicyExpression, type SecurityOperation, type SecurityRule } from "@rebasepro/types";
import { adminRequestPolicyName, getPolicyNamesForRule } from "@rebasepro/utils";
import { findRelation, getTableName, resolveCollectionRelations } from "../relations";
import { securityRuleToConditions } from "./securityRuleToConditions";
import { policyShorthandColumns } from "./policyCondition";
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
    /**
     * Set on the companion of an admin-only policy: the same operation, `TO`
     * `rebase_admin_request`, `USING (true)` — so an admin request's plan
     * carries no policy barrier and uses the indexes the owner's does (see
     * `REBASE_ADMIN_REQUEST_ROLE`). Never written to any other role: where
     * that role cannot exist the companion is left out, never moved `TO
     * public` the way an {@link adminTarget} policy is — `TO public USING
     * (true)` would hand every row to everyone.
     */
    adminRequestTarget?: true;
}

export interface RulePolicyCompileOptions extends PolicyCompileOptions {
    /**
     * The caller runs admin requests as a role inside `rebase_admin` (the
     * Postgres driver from the release that introduced `rls.adminPolicies`), so
     * a server-or-admin grant may be written `TO rebase_admin` when the
     * declaration allows it. Off by default, and that is load-bearing: the
     * managed runtime supplies this package to bundles that vendor an older
     * driver, which never switches admins to such a role — compiled `TO
     * rebase_admin` under it, every admin request would be refused.
     */
    adminRole?: boolean;
    /**
     * Give each admin-only policy its `TO rebase_admin_request USING (true)`
     * companion ({@link CompiledRulePolicy.adminRequestTarget}). Only with
     * {@link adminRole}, and off by default for the same reason: a driver that
     * does not create that role must not be handed policies naming it.
     */
    adminRequestRole?: boolean;
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
    options?: RulePolicyCompileOptions
): CompiledRulePolicy[] {
    const ops = rule.operations && rule.operations.length > 0 ? rule.operations : [rule.operation ?? "all"];
    const tableName = getTableName(collection);
    if (isRedactedSecurityRule(rule)) {
        // The marker stands for SQL this process was not shown. A policy
        // compiled from it would grant or deny by a guess.
        throw new Error(
            `A rule on "${tableName}" is the \`redacted: true\` marker \`GET /api/schema/tables\` serves in place of ` +
            "a rule whose SQL it withheld. It describes a policy; it cannot become one. Write the rule itself."
        );
    }
    assertShorthandColumns(collection, rule, tableName);
    const policyNames = getPolicyNamesForRule(rule, tableName);
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule, { table: tableName });
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
    const adminOnly = mode === "permissive" && !rule.pgRoles && options?.adminRole === true
        && shape.adminPolicies === "adminRole";

    return ops.flatMap((operation, index): CompiledRulePolicy[] => {
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
        const policy: CompiledRulePolicy = {
            name: policyNames[index],
            operation,
            mode,
            roles: rule.pgRoles ? [...rule.pgRoles].sort() : [forAdmins ? REBASE_ADMIN_ROLE : "public"],
            ...(forAdmins ? { adminTarget: true as const } : {}),
            using: using === null ? null : forRequestRoles(using),
            withCheck: withCheck === null ? null : forRequestRoles(withCheck)
        };
        // Only where every admin request passes the policy anyway — a request
        // runs as an admin request role only because its caller holds `admin`
        // — does the companion admit them outright, as a constant Postgres
        // folds away. `admin AND owner = me` is admin-only too, and gets none:
        // `true` would widen it. Not narrowed to the request roles: it already
        // applies to nothing else, and a non-constant clause would bring the
        // barrier back.
        const everyAdminPasses = forAdmins
            && (!needsUsing || admitsEveryAdminRequest(usingExpr))
            && (!needsWithCheck || admitsEveryAdminRequest(withCheckExpr));
        if (!everyAdminPasses || options?.adminRequestRole !== true) return [policy];
        return [policy, {
            name: adminRequestPolicyName(policyNames[index]),
            operation,
            mode: "permissive",
            roles: [REBASE_ADMIN_REQUEST_ROLE],
            adminRequestTarget: true,
            using: needsUsing ? "true" : null,
            withCheck: needsWithCheck ? "true" : null
        }];
    });
}

/**
 * Refuse a `PolicyShorthand` condition / check naming a key that is no column
 * of the table — no property, and no `belongsTo` relation (which addresses its
 * foreign-key column). The compiler snake-cases a name it does not know, so a
 * typo would otherwise reach `CREATE POLICY` as a column that does not exist,
 * fail there, and leave the table with RLS on and no policy.
 */
function assertShorthandColumns(collection: CollectionConfig, rule: SecurityRule, tableName: string): void {
    const clauses = [["condition", rule.condition], ["check", rule.check]] as const;
    for (const [clause, condition] of clauses) {
        for (const column of policyShorthandColumns(condition)) {
            if (addressesColumn(collection, column)) continue;
            throw new Error(
                `A rule on "${tableName}" names "${column}" in its \`${clause}\`, and "${tableName}" has no such ` +
                "column. A shorthand's keys are column keys of the table: name one of " +
                `${Object.keys(collection.properties ?? {}).map(k => `"${k}"`).join(", ") || "its columns"}.`
            );
        }
    }
}

function addressesColumn(collection: CollectionConfig, key: string): boolean {
    if (collection.properties && Object.prototype.hasOwnProperty.call(collection.properties, key)) return true;
    try {
        return findRelation(resolveCollectionRelations(collection), key)?.kind === "belongsTo";
    } catch {
        // A relation whose target is not in this bundle: it names no column here.
        return false;
    }
}

/**
 * Whether a clause is true for every request made by a caller holding the
 * `admin` role, whoever they are and whatever row: the companion test
 * (`adminRequestTarget`). Stricter than {@link requiresServerOrAdmin}, which
 * asks the opposite question: `admin AND owner = me` can only pass for an
 * admin, but not every admin passes it. Structural and conservative: anything
 * it cannot read answers `false`, and the policy gets no companion.
 */
export function admitsEveryAdminRequest(expr: PolicyExpression | null): boolean {
    if (!expr) return false;
    switch (expr.kind) {
        case "rolesOverlap":
            return expr.roles.includes("admin");
        case "rolesContain":
            return expr.roles.length > 0 && expr.roles.every(role => role === "admin");
        case "and":
            return expr.operands.length > 0 && expr.operands.every(admitsEveryAdminRequest);
        case "or":
            return expr.operands.some(admitsEveryAdminRequest);
        default:
            return false;
    }
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
