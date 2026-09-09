/**
 * The one reading of `collection.tenant`.
 *
 * Four things have to agree for a tenant-scoped collection to work — the
 * column, the RLS policy, the value stamped on insert and the index — and
 * before this they were four hand-written declarations that nothing compared.
 * The three that are schema become a {@link SecurityRule} and a column effect
 * derived here and in `planSchema`; the fourth, the write path, is
 * {@link resolveTenantWrite}.
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
    type EntityStatus,
    type PolicyExpression,
    type SecurityRule
} from "@rebasepro/types";
import { getTableName } from "./relations";

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
export function tenantBypassRoles(tenant: CollectionTenantConfig): readonly string[] {
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
export function tenantScopeExpression(tenant: CollectionTenantConfig): PolicyExpression {
    const match: PolicyExpression = isTenantClaimSource(tenant.from)
        ? policy.compare(policy.field(tenant.field), "eq", policy.authClaim(tenant.from.claim))
        : policy.existsIn({
            collection: tenant.from.membership.collection,
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
export function buildTenantSecurityRule(collection: CollectionConfig): SecurityRule | undefined {
    const tenant = getTenantConfig(collection);
    if (!tenant) return undefined;
    const expression = tenantScopeExpression(tenant);
    return {
        name: tenantPolicyName(getTableName(collection)),
        mode: "restrictive",
        operation: "all",
        condition: expression,
        check: expression
    };
}

// ── The write path ───────────────────────────────────────────────────────────

/** Why a write was refused by tenancy. */
export interface TenantWriteRefusal {
    code: "TENANT_REQUIRED" | "TENANT_MISMATCH" | "TENANT_IMMUTABLE";
    /** The property, for a `violations` entry and for the message. */
    field: string;
    message: string;
}

/** What {@link resolveTenantWrite} decided. */
export type TenantWriteDecision =
    /** The values to write, with the tenant stamped if it was missing. */
    | { values: Record<string, unknown>; refusal?: undefined }
    | { refusal: TenantWriteRefusal; values?: undefined };

export interface TenantWriteInput {
    tenant: CollectionTenantConfig;
    /** The write's values, after defaults and hooks. */
    values: Record<string, unknown>;
    status: EntityStatus;
    /**
     * Every tenant the caller may write into.
     *
     * One entry for a claim, however many memberships they hold for the
     * membership form, and none for a caller carrying neither.
     */
    callerTenants: readonly unknown[];
    /**
     * Whether `callerTenants` is the whole list.
     *
     * A membership lookup is capped — a caller with more memberships than the
     * cap would otherwise make every write of theirs a large read. When the cap
     * is hit this is `false`, and a value that is not in the list is **let
     * through** rather than refused: the list is no longer evidence of absence,
     * and the policy's `WITH CHECK` is what actually decides. The API check is
     * an earlier, clearer refusal of the same writes, never a second authority.
     */
    callerTenantsComplete?: boolean;
    /**
     * True when tenancy does not apply to this caller — a bypass role, or the
     * trusted server context. The same set the policy lets through, so the API
     * and the database refuse the same writes.
     */
    bypass: boolean;
    /** The row's current values, on an update. */
    previousValues?: Record<string, unknown>;
    /** The collection slug, for the message. */
    slug: string;
}

/**
 * An id, however it arrived.
 *
 * A tenant field may be a `belongsTo` relation or a `reference`, and those
 * arrive over the wire as `{ id }` envelopes as often as bare ids. Comparing
 * the envelope to a bare id would refuse every correct write with
 * `TENANT_MISMATCH`, which is the most confusing possible failure — the caller
 * sent exactly the tenant they belong to.
 */
function tenantIdOf(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "object") {
        const id = (value as { id?: unknown }).id;
        return id === undefined ? value : id;
    }
    return value;
}

/**
 * Compare two tenant ids as the database will.
 *
 * Stringified, because JSON has one number type and Postgres has several: a
 * caller sending `"42"` for a `bigint` tenant column is writing the same row as
 * one sending `42`, and Postgres agrees after the cast. Refusing one of them
 * would be an API rule the database does not have.
 */
function sameTenant(a: unknown, b: unknown): boolean {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return String(tenantIdOf(a)) === String(tenantIdOf(b));
}

/**
 * Stamp, or refuse, the tenant on a write.
 *
 * Three refusals, and each exists because the alternative lands somewhere
 * worse:
 *
 * - **`TENANT_REQUIRED`** — the caller has no tenant, or belongs to several and
 *   named none. Stamping a guess would put the row in the wrong tenant; letting
 *   it through would write a NULL into a `NOT NULL` column and surface as a
 *   23502 naming a column the caller never wrote.
 * - **`TENANT_MISMATCH`** — the caller named a tenant that is not theirs. The
 *   database refuses this too, through the policy's `WITH CHECK`, but as a
 *   42501 "new row violates row-level security policy" with no mention of which
 *   field or why. Refused here so the answer names the field.
 * - **`TENANT_IMMUTABLE`** — an update that moves a row to another tenant. RLS
 *   would allow it whenever the caller belongs to both, and it is almost never
 *   what anybody meant: it takes the row out of one tenant's history and drops
 *   it into another's, with no trace on either side. A deliberate move is a
 *   `bypassRoles` operation.
 *
 * A bypass caller is exempt from all three: they are trusted across tenants by
 * declaration, and stamping their write would silently confine a support
 * operator's row to whichever tenant they happen to carry.
 */
export function resolveTenantWrite(input: TenantWriteInput): TenantWriteDecision {
    const { tenant, values, status, callerTenants, bypass, previousValues, slug } = input;
    const field = tenant.field;
    const complete = input.callerTenantsComplete !== false;
    /** Is `value` one the caller may write? Unknown counts as yes — see `callerTenantsComplete`. */
    const callerHas = (value: unknown): boolean =>
        callerTenants.some(t => sameTenant(t, value)) || !complete;

    if (bypass) return { values };

    const provided = values[field];
    const creating = status !== "existing";

    if (!creating) {
        // An update that does not mention the field cannot move the row, and
        // the row's own tenant is already what RLS checked to let the update
        // through. Nothing to do.
        if (provided === undefined) return { values };

        const previous = previousValues?.[field];
        if (previous !== undefined && !sameTenant(provided, previous)) {
            return {
                refusal: {
                    code: "TENANT_IMMUTABLE",
                    field,
                    message:
                        `'${field}' is the tenant '${slug}' rows belong to, and a row cannot change tenant. ` +
                        `This update would move it from '${String(tenantIdOf(previous))}' to ` +
                        `'${String(tenantIdOf(provided))}'. Create the row in the other tenant and delete ` +
                        "this one, or perform the move with a role listed in `tenant.bypassRoles`."
                }
            };
        }
        if (previous === undefined && !callerHas(provided)) {
            return { refusal: mismatch(field, slug, provided, callerTenants) };
        }
        return { values };
    }

    if (provided === undefined || provided === null || provided === "") {
        if (callerTenants.length === 1) {
            return { values: { ...values, [field]: tenantIdOf(callerTenants[0]) } };
        }
        return {
            refusal: {
                code: "TENANT_REQUIRED",
                field,
                message: callerTenants.length === 0
                    ? `'${slug}' is scoped to a tenant and this request carries none, so there is nothing ` +
                      `to write into '${field}'. ` + sourceHint(tenant)
                    : `'${slug}' is scoped to a tenant and this caller belongs to ${callerTenants.length} ` +
                      `of them, so '${field}' cannot be inferred. Send it on the write — it must be one ` +
                      "the caller belongs to."
            }
        };
    }

    if (!callerHas(provided)) {
        return { refusal: mismatch(field, slug, provided, callerTenants) };
    }

    return { values };
}

function mismatch(
    field: string,
    slug: string,
    provided: unknown,
    callerTenants: readonly unknown[]
): TenantWriteRefusal {
    return {
        code: "TENANT_MISMATCH",
        field,
        message:
            `'${field}' names tenant '${String(tenantIdOf(provided))}', which this caller does not belong ` +
            `to, so the write to '${slug}' would be refused by the database as well. ` +
            (callerTenants.length === 0
                ? "This request carries no tenant at all."
                : `The caller's ${callerTenants.length === 1 ? "tenant is" : "tenants are"} ` +
                  callerTenants.map(t => `'${String(tenantIdOf(t))}'`).join(", ") + ".")
    };
}

/** Where a caller's tenant was supposed to come from, for the 400. */
function sourceHint(tenant: CollectionTenantConfig): string {
    return isTenantClaimSource(tenant.from)
        ? `The tenant comes from the '${tenant.from.claim}' claim on the caller's token; this one has no ` +
          "such claim. Sign in, or add the claim in the custom-claims hook."
        : `The tenant comes from rows of '${tenant.from.membership.collection}' whose ` +
          `'${tenant.from.membership.userField}' is the caller; this caller has none.`;
}
