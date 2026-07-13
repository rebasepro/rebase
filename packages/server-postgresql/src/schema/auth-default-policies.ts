import { CollectionConfig, SecurityRule, SecurityOperation, AuthCollectionConfig, PolicyExpression, isPostgresCollectionConfig, policy } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";

/**
 * Default RLS policies injected by the schema generator.
 *
 * Rebase's enforcement model: **reads** are gated by Postgres RLS (`select`
 * rules compile to policies and the runtime executes authenticated reads under
 * the restricted `rebase_reader` role), while **writes** are gated by
 * app-layer callbacks — except on auth collections, whose tables are
 * `FORCE ROW LEVEL SECURITY` so the admin write gate below binds even the
 * table owner.
 *
 * Because RLS default-denies once it actually applies, every collection needs
 * a sane baseline. The generator injects:
 *
 * **For every collection**
 *  1. A permissive **server-or-admin SELECT** grant. Without it, enabling RLS
 *     would blind the trusted server context and the admin studio on any
 *     collection whose author wrote no `select` rule. Author rules are
 *     permissive and OR together, so explicit rules only broaden access.
 *
 * **For auth collections additionally**
 *  2. A permissive **self SELECT** grant (`id = auth.uid()`), so users can
 *     read their own row (profile, session bootstrap) without every app
 *     re-declaring it.
 *  3. A **restrictive** admin write gate. Restrictive policies are AND'd with
 *     every other policy, so a write is rejected unless the caller is an admin
 *     (or the trusted server context) — even if the author also wrote a
 *     permissive rule such as "a user may edit their own row". Without this, a
 *     permissive owner rule would let a user change their own `roles`.
 *  4. A permissive **admin write** grant. Restrictive policies only constrain;
 *     at least one permissive policy must also pass, so this grants the
 *     baseline write so admins (and the server context) can manage users.
 *
 * The server context is recognised as `auth.uid() IS NULL` — the built-in
 * flows that run without a user (signup, migrations) set no user GUC.
 *
 * Opt out with `disableDefaultPolicies: true` to take full responsibility for
 * the collection's RLS.
 */
// Expressed structurally (not as raw SQL) so the admin UI can evaluate it
// exactly — the framework's most security-critical policies must be reflected
// precisely, not left as un-evaluable raw clauses. Compiles to
// `auth.uid() IS NULL OR (string_to_array(auth.roles(), ',') && ARRAY['admin'])`.
const SERVER_OR_ADMIN_EXPR: PolicyExpression = policy.or(
    policy.not(policy.authenticated()),
    policy.rolesOverlap(["admin"])
);

/** Write operations that must be admin-gated by default on auth collections. */
const DEFAULT_GUARDED_OPS: SecurityOperation[] = ["insert", "update", "delete"];

/** Whether a collection is flagged as an authentication collection. */
function isAuthCollection(collection: CollectionConfig): boolean {
    const auth = collection.auth;
    return auth === true || (typeof auth === "object" && (auth as AuthCollectionConfig)?.enabled === true);
}

/** The property marked as the row id (falls back to `id`). */
function getIdPropertyName(collection: CollectionConfig): string {
    for (const [name, prop] of Object.entries(collection.properties ?? {})) {
        if (prop && typeof prop === "object" && "isId" in prop && (prop as { isId?: unknown }).isId) {
            return name;
        }
    }
    return "id";
}

/**
 * Returns the security rules that should be applied to a collection: the
 * author's explicit `securityRules` plus the framework defaults described in
 * the module doc (baseline server/admin read for all collections; self-read
 * and the admin write gate for auth collections).
 *
 * Collections that opt out via `disableDefaultPolicies` are returned unchanged.
 */
export function getEffectiveSecurityRules(collection: CollectionConfig): SecurityRule[] {
    const explicit = [...((isPostgresCollectionConfig(collection) ? collection.securityRules : undefined) ?? [])];

    if (collection.disableDefaultPolicies) {
        return explicit;
    }

    const tableName = getTableName(collection);
    const injected: SecurityRule[] = [];

    // Baseline read: the trusted server context and admins can always SELECT.
    // RLS default-denies reads under the reader role, so without this a
    // rule-less collection would be unreadable — including by the admin studio.
    injected.push({
        name: `${tableName}_default_admin_read`,
        operations: ["select"],
        condition: SERVER_OR_ADMIN_EXPR
    });

    if (isAuthCollection(collection)) {
        // Self-read: a user can always read their own row.
        injected.push({
            name: `${tableName}_default_self_read`,
            operations: ["select"],
            condition: policy.compare(policy.field(getIdPropertyName(collection)), "eq", policy.authUid())
        });

        // Restrictive gate: AND'd with all other policies, so no permissive rule
        // (e.g. an owner "edit your own row" rule) can let a non-admin through.
        injected.push({
            name: `${tableName}_require_admin_write`,
            mode: "restrictive",
            operations: [...DEFAULT_GUARDED_OPS],
            condition: SERVER_OR_ADMIN_EXPR,
            check: SERVER_OR_ADMIN_EXPR
        });

        // Permissive grant: a restrictive policy alone denies everything, so this
        // grants the baseline write to admins / the server context.
        injected.push({
            name: `${tableName}_default_admin_write`,
            operations: [...DEFAULT_GUARDED_OPS],
            condition: SERVER_OR_ADMIN_EXPR,
            check: SERVER_OR_ADMIN_EXPR
        });
    }

    return [...explicit, ...injected];
}
