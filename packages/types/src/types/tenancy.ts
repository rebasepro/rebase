/**
 * First-class multi-tenancy: one declaration, every layer.
 *
 * A tenant-scoped collection was expert work. It took four separate,
 * hand-written pieces that nothing checked against each other — a column, an
 * `existsIn` or raw RLS rule, a value stamped on every insert by a callback,
 * and an index somebody had to remember. Miss the index and the table scans;
 * miss the stamp and the row is invisible the moment it is written; miss the
 * rule and every tenant reads every other tenant's rows, which is the failure
 * nothing surfaces until it is a disclosure.
 *
 * {@link CollectionTenantConfig} is the one place that says "this collection
 * belongs to a tenant", and the four pieces are derived from it:
 *
 *  - the column is `NOT NULL` and gets a btree index (`planSchema`);
 *  - a **restrictive** RLS policy is injected for every operation, so it
 *    composes with (rather than replaces) whatever `securityRules` the
 *    collection declares — tenancy narrows, it never grants;
 *  - the write path stamps the caller's tenant on create, refuses a write that
 *    names another tenant, and refuses an update that moves a row between
 *    tenants;
 *  - the OpenAPI document marks the field so a generated client can see it.
 *
 * @see CollectionTenantConfig
 * @group Models
 */

/**
 * The caller's tenant comes from a claim on their session token.
 *
 * The single-tenant-per-user shape: an identity provider (or Rebase's own
 * custom-claims hook) puts the organization on the token, and every request
 * carries it. Compiles to a comparison against `rebase.jwt() ->> '<claim>'`,
 * which is the same value a hand-written rule would read — so the generated
 * policy and anything an author writes beside it agree by construction.
 *
 * @group Models
 */
export interface TenantClaimSource {
    /**
     * The claim's name on the access token, e.g. `"org_id"`.
     *
     * Custom claims survive verification and reach RLS as `rebase.jwt()`; the
     * identity claims (`uid`, `roles`, `aal`, `isAnonymous`) are written after
     * them when a token is minted and cannot be shadowed, so naming one of
     * those here is refused rather than quietly reading the identity.
     */
    claim: string;
}

/**
 * The caller's tenants come from rows of a membership collection.
 *
 * The many-tenants-per-user shape — a `memberships` table with a user column
 * and a tenant column, which is how a person belongs to three organizations at
 * once. Compiles to a correlated `EXISTS` over that table (`policy.existsIn`),
 * so the database answers "is the caller a member of this row's tenant?" in the
 * same query rather than in an N+1 of lookups.
 *
 * Nothing is put on the token, so nothing has to be re-minted when somebody
 * joins or leaves a tenant — the next statement already sees the new row.
 *
 * @group Models
 */
export interface TenantMembershipSource {
    membership: {
        /** Slug of the collection holding the memberships. */
        collection: string;
        /** The property on it that holds the user id (compared to `rebase.uid()`). */
        userField: string;
        /** The property on it that holds the tenant id. */
        tenantField: string;
    };
}

/** Where the caller's tenant comes from. @group Models */
export type TenantSource = TenantClaimSource | TenantMembershipSource;

/** Narrow a {@link TenantSource} to its claim form. @group Models */
export function isTenantClaimSource(source: TenantSource): source is TenantClaimSource {
    return typeof (source as TenantClaimSource).claim === "string";
}

/** Narrow a {@link TenantSource} to its membership form. @group Models */
export function isTenantMembershipSource(source: TenantSource): source is TenantMembershipSource {
    return typeof (source as TenantMembershipSource).membership === "object"
        && (source as TenantMembershipSource).membership !== null;
}

/**
 * The roles tenancy does not apply to, when the collection names none.
 *
 * `admin`, mirroring the security baseline every collection already carries
 * (`<table>_default_admin_read` / `_write`): the Studio, `dataAsAdmin` and a
 * support operator all run with it, and a tenancy rule that locked them out
 * would make the admin panel show an empty table on a collection full of rows.
 *
 * @group Models
 */
export const DEFAULT_TENANT_BYPASS_ROLES: readonly string[] = ["admin"];

/**
 * Declare a collection tenant-scoped.
 *
 * ```ts
 * export const posts = buildCollection({
 *     slug: "posts",
 *     properties: {
 *         orgId: { type: "string", validation: { required: true } },
 *         title: { type: "string" }
 *     },
 *     tenant: { field: "orgId", from: { claim: "org_id" } }
 * });
 * ```
 *
 * The property has to exist — this says what a column *means*, it does not
 * conjure one into existence, exactly like `softDelete`. A config naming a
 * property the collection does not declare is refused at boot rather than at
 * the first read.
 *
 * ## What it composes with
 *
 * The injected policy is **restrictive**, so it is ANDed with every permissive
 * policy on the table: `securityRules`, `ownerField`, the injected admin
 * baseline. That is the only composition that is safe by construction — a
 * permissive tenancy policy would OR with the author's rules and a single
 * `access: "public"` rule would take the whole tenancy boundary off.
 *
 * Postgres-only. RLS is what enforces it, and an engine without row-level
 * security cannot be given this guarantee by an application-layer filter that
 * a raw query goes around.
 *
 * @group Models
 */
export interface CollectionTenantConfig<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * The property holding the tenant id.
     *
     * A `string` or `number` property, or a `reference` / `belongsTo` relation
     * to the tenants collection — in which case the foreign key the relation
     * already declares is the column, and no second one is created.
     *
     * The column is made `NOT NULL` and indexed: a nullable tenant column is a
     * row that belongs to nobody and is therefore invisible to everybody, and
     * an unindexed one turns every RLS-filtered read into a sequential scan.
     */
    field: Extract<keyof M, string> | string;

    /** Where the caller's tenant comes from. */
    from: TenantSource;

    /**
     * Roles that see and write across every tenant.
     *
     * Defaults to {@link DEFAULT_TENANT_BYPASS_ROLES}. An empty array means
     * "nobody bypasses" — the trusted server context still does, because it is
     * what runs migrations and the auth flows, and a policy that excluded it
     * would break the boot rather than protect a tenant.
     */
    bypassRoles?: readonly string[];
}
