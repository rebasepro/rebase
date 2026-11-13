/**
 * The one reading of `collection.tenant`.
 *
 * Four things have to agree for a tenant-scoped collection to work — the
 * column, the RLS policy, the value stamped on insert and the index — and
 * before this they were four hand-written declarations that nothing compared.
 * The three that are schema become a {@link SecurityRule} and a column effect
 * derived here and in `planSchema`; the fourth, the write path, is
 * `resolveTenantWrite` (`runtime/tenant-write.ts`).
 *
 * Everything in this module is pure. The policy it builds is a `SecurityRule`
 * like any other, which is what makes `db push`, the doctor, boot-ensure, the
 * drift detector and the Studio treat the tenancy policy as what it is —
 * generated, named, and recognisable — rather than as somebody's hand-written
 * SQL that a push should offer to drop.
 */
import {
    DEFAULT_TENANT_BYPASS_ROLES,
    isTenantClaimSource,
    policy,
    type CollectionConfig,
    type CollectionTenantConfig,
    type PolicyExpression,
    type SecurityRule,
    type TenantDescriptor
} from "@rebasepro/types";

/**
 * The collection's tenancy declaration, or nothing.
 *
 * Read through this rather than off the object, so the one shape check —
 * `tenant` is an object carrying a `field` and a `from` — is in one place. A
 * config that is *wrong* is refused by `validateCollectionConfig` with a
 * message; this is only asking whether there is one.
 */
export function getTenantConfig(collection: CollectionConfig | undefined): CollectionTenantConfig | undefined {
    const tenant = (collection as { tenant?: unknown } | undefined)?.tenant as CollectionTenantConfig | undefined;
    if (!tenant || typeof tenant !== "object") return undefined;
    if (typeof tenant.field !== "string" || !tenant.field) return undefined;
    if (!tenant.from || typeof tenant.from !== "object") return undefined;
    return tenant;
}

/** The roles tenancy does not apply to, defaulted. */
export function tenantBypassRoles(tenant: Pick<TenantDescriptor, "bypassRoles">): readonly string[] {
    return tenant.bypassRoles ?? DEFAULT_TENANT_BYPASS_ROLES;
}

/**
 * The name of the policy a tenant declaration compiles to.
 *
 * Explicit — not a `getPolicyNameHash` of the rule — precisely because the
 * rule's *body* is compiled with more information in some callers than in
 * others (`planSchema` can resolve a relation's target collection and so knows
 * the column's type; the Studio, asking only for names, cannot). A hashed name
 * would then differ between the two, and the same policy would read as drift.
 * A frozen identifier: see `contracts/derived-names.txt`.
 */
export function tenantPolicyName(tableName: string): string {
    return `${tableName}_tenant_scope`;
}

/** The `reason` on the index a tenant column gets. Rendered into `schema.sql`. */
export const TENANT_INDEX_REASON = "tenant scope";

/**
 * The condition a tenant declaration means, as a policy expression.
 *
 * `serverContext()` first, for the same reason every injected baseline rule
 * carries it: the trusted plane runs migrations, the auth flows and the boot,
 * and a restrictive policy that excluded it would not protect a tenant, it
 * would stop the server from starting.
 *
 * Then the bypass roles, then the tenancy test itself — a claim comparison or a
 * correlated `EXISTS` over the membership table, which are the two ways a
 * deployment answers "which tenant is this caller in".
 */
export function tenantScopeExpression(tenant: TenantDescriptor): PolicyExpression {
    const match: PolicyExpression = isTenantClaimSource(tenant.from)
        ? policy.compare(policy.field(tenant.field), "eq", policy.authClaim(tenant.from.claim))
        : policy.existsIn({
            table: tenant.from.membership.table,
            where: policy.and(
                policy.compare(
                    policy.field(tenant.from.membership.tenantField),
                    "eq",
                    policy.outerField(tenant.field)
                ),
                policy.compare(
                    policy.field(tenant.from.membership.userField),
                    "eq",
                    policy.authUid()
                )
            )
        });

    const bypass = tenantBypassRoles(tenant);
    return bypass.length > 0
        ? policy.or(policy.serverContext(), policy.rolesOverlap(bypass), match)
        : policy.or(policy.serverContext(), match);
}

/**
 * The rule a tenant declaration compiles to, or nothing when there is none.
 *
 * **Restrictive**, and that is the whole design. A restrictive policy is ANDed
 * with every other policy on the table, so tenancy narrows what the
 * collection's own `securityRules` allow and can never widen it. A permissive
 * one would OR with them, and a single `access: "public"` rule elsewhere in the
 * file would take the entire tenancy boundary off without contradicting
 * anything a reader could see.
 *
 * One rule with `operation: "all"` rather than four with `operations: [...]`:
 * `FOR ALL` gives Postgres the USING clause for SELECT/UPDATE/DELETE and the
 * WITH CHECK clause for INSERT/UPDATE, which is exactly the coverage wanted,
 * as one policy with one name instead of four.
 */
export function tenantSecurityRule(tableName: string, tenant: TenantDescriptor): SecurityRule {
    const expression = tenantScopeExpression(tenant);
    return {
        name: tenantPolicyName(tableName),
        mode: "restrictive",
        operation: "all",
        condition: expression,
        check: expression
    };
}
