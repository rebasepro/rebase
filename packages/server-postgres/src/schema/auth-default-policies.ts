import { CollectionConfig, SecurityRule, SecurityOperation, AuthCollectionConfig, PolicyExpression, isPostgresCollectionConfig, policy } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";

/**
 * Default RLS policies injected by the schema generator.
 *
 * Rebase's enforcement model is unified: authenticated (user-context) requests
 * run under the restricted `rebase_user` role, so Postgres RLS binds *every*
 * statement — reads and writes. A collection's `securityRules` are the whole
 * authorization model. The server context (auth flows, migrations,
 * `dataAsAdmin`) runs as the owner and bypasses RLS.
 *
 * Because RLS default-denies, every collection is **locked by default**: with
 * no rules, only the server context and admins can touch it. The generator
 * injects that safe baseline:
 *
 * **For every collection**
 *  1. A permissive **server-or-admin SELECT** grant.
 *  2. A permissive **server-or-admin write** grant (insert/update/delete).
 *
 * Author `securityRules` are permissive and OR together, so explicit rules only
 * *broaden* access from this locked baseline (e.g. "users read/write their own
 * rows").
 *
 * **For auth collections additionally**
 *  3. A permissive **self SELECT** grant (`id = auth.uid()`), so users can read
 *     their own row (profile, session bootstrap) without every app re-declaring
 *     it.
 *  4. A **restrictive** admin write gate. Restrictive policies are AND'd with
 *     every other policy, so a write is rejected unless the caller is an admin
 *     (or the server context) — even if the author also wrote a permissive rule
 *     such as "a user may edit their own row". Without this, a permissive owner
 *     rule would let a user change their own `roles`.
 *
 * The server context is recognised as `auth.uid() IS NULL` (`policy.serverContext()`)
 * — the built-in flows that run without a user (signup, migrations) set no user
 * GUC — which also lets the owner connection satisfy these policies even under
 * FORCE RLS. A *user* request never reaches that state: an anonymous one carries
 * `ANONYMOUS_USER_ID`, precisely so it cannot pass for the server here.
 *
 * Opt out with `disableDefaultPolicies: true` to take full responsibility for
 * the collection's RLS.
 */
// Expressed structurally (not as raw SQL) so the admin UI can evaluate it
// exactly — the framework's most security-critical policies must be reflected
// precisely, not left as un-evaluable raw clauses. Compiles to
// `auth.uid() IS NULL OR (string_to_array(auth.roles(), ',') && ARRAY['admin'])`.
//
// `serverContext()`, emphatically not `not(authenticated())`: the server arm of
// this grant must match the server context and nothing else. Anonymous visitors
// are not signed in either, so a negated `authenticated()` would hand them the
// server-or-admin grant on every collection's default policy.
const SERVER_OR_ADMIN_EXPR: PolicyExpression = policy.or(
    policy.serverContext(),
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

    // Baseline read + write: the server context and admins can always operate.
    // RLS default-denies under the user role, so without these a rule-less
    // collection would be locked to everyone — including the admin studio.
    // Author rules are permissive and broaden access from here.
    injected.push({
        name: `${tableName}_default_admin_read`,
        operations: ["select"],
        condition: SERVER_OR_ADMIN_EXPR
    });
    injected.push({
        name: `${tableName}_default_admin_write`,
        operations: [...DEFAULT_GUARDED_OPS],
        condition: SERVER_OR_ADMIN_EXPR,
        check: SERVER_OR_ADMIN_EXPR
    });

    if (isAuthCollection(collection)) {
        // Self-read: a user can always read their own row.
        injected.push({
            name: `${tableName}_default_self_read`,
            operations: ["select"],
            condition: policy.compare(policy.field(getIdPropertyName(collection)), "eq", policy.authUid())
        });

        // Restrictive gate: AND'd with all other policies, so no permissive rule
        // (e.g. an owner "edit your own row" rule) can let a non-admin change
        // privileged columns like `roles`.
        injected.push({
            name: `${tableName}_require_admin_write`,
            mode: "restrictive",
            operations: [...DEFAULT_GUARDED_OPS],
            condition: SERVER_OR_ADMIN_EXPR,
            check: SERVER_OR_ADMIN_EXPR
        });
    }

    return [...explicit, ...injected];
}
