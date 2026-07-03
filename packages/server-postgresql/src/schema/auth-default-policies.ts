import { SnapshotCollection, SecurityRule, SecurityOperation, AuthCollectionConfig, PolicyExpression, isPostgresCollection, policy } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";

/**
 * Default RLS for authentication collections.
 *
 * Users are persisted through the same write path as any other collection —
 * the only thing that distinguishes them is the `auth` flag. That means
 * privileged columns (most importantly `roles`) would be editable by any
 * authenticated user unless the collection author remembers to write a correct
 * admin-only write policy.
 *
 * To make this safe by default, the schema generator injects two policies for
 * every write operation on an auth collection. Enforcement lives in the
 * database (RLS), so it applies to every write path — REST, WebSocket, and any
 * internal caller — not just one entry point:
 *
 *  1. A **restrictive** admin gate. Restrictive policies are AND'd with every
 *     other policy, so this guarantees a write is rejected unless the caller is
 *     an admin (or the trusted server context) — even if the author also wrote
 *     a permissive rule such as "a user may edit their own row". Without this,
 *     a permissive owner rule would let a user change their own `roles`.
 *
 *  2. A **permissive** admin grant. Restrictive policies only constrain; at
 *     least one permissive policy must also pass for the write to be allowed.
 *     This grants the baseline write so admins (and the server context) can
 *     manage users even when the collection has no other permissive write rule.
 *
 * Both mirror the framework's trusted-server convention: the write is allowed
 * when there is no authenticated user context (`auth.uid() IS NULL`, used by
 * the built-in auth flows that run as the service role) OR the caller holds the
 * `admin` role. Net effect: only admins (or the server) can write the row, and
 * therefore only admins can change privileged columns like `roles`.
 *
 * Author-provided write rules are preserved but cannot loosen this guarantee —
 * a non-admin write is always blocked by the restrictive gate. To take full
 * control of an auth collection's write authorization, set
 * `disableDefaultAuthPolicies: true` on the collection.
 */
// Expressed structurally (not as raw SQL) so the admin UI can evaluate it
// exactly — the framework's most security-critical policy must be reflected
// precisely, not left as an un-evaluable raw clause. Compiles to
// `auth.uid() IS NULL OR (string_to_array(auth.roles(), ',') && ARRAY['admin'])`.
const ADMIN_WRITE_EXPR: PolicyExpression = policy.or(
    policy.not(policy.authenticated()),
    policy.rolesOverlap(["admin"])
);

/** Write operations that must be admin-gated by default on auth collections. */
const DEFAULT_GUARDED_OPS: SecurityOperation[] = ["insert", "update", "delete"];

/** Whether a collection is flagged as an authentication collection. */
function isAuthCollection(collection: SnapshotCollection): boolean {
    const auth = collection.auth;
    return auth === true || (typeof auth === "object" && (auth as AuthCollectionConfig)?.enabled === true);
}

/**
 * Returns the security rules that should be applied to a collection: the
 * author's explicit `securityRules`, plus, for auth collections, an
 * auto-injected restrictive admin gate and permissive admin grant on every
 * write operation. Together these guarantee only admins (or the trusted server
 * context) can write the row.
 *
 * Non-auth collections, and auth collections that opt out via
 * `disableDefaultAuthPolicies`, are returned unchanged.
 */
export function getEffectiveSecurityRules(collection: SnapshotCollection): SecurityRule[] {
    const explicit = [...((isPostgresCollection(collection) ? collection.securityRules : undefined) ?? [])];

    if (!isAuthCollection(collection) || collection.disableDefaultAuthPolicies) {
        return explicit;
    }

    const tableName = getTableName(collection);

    // Restrictive gate: AND'd with all other policies, so no permissive rule
    // (e.g. an owner "edit your own row" rule) can let a non-admin through.
    const requireAdminGate: SecurityRule = {
        name: `${tableName}_require_admin_write`,
        mode: "restrictive",
        operations: [...DEFAULT_GUARDED_OPS],
        condition: ADMIN_WRITE_EXPR,
        check: ADMIN_WRITE_EXPR
    };

    // Permissive grant: a restrictive policy alone denies everything, so this
    // grants the baseline write to admins / the server context.
    const allowAdminWrite: SecurityRule = {
        name: `${tableName}_default_admin_write`,
        operations: [...DEFAULT_GUARDED_OPS],
        condition: ADMIN_WRITE_EXPR,
        check: ADMIN_WRITE_EXPR
    };

    return [...explicit, allowAdminWrite, requireAdminGate];
}
