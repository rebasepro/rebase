/**
 * The admin role and scope matching, for code that may not import
 * `@rebasepro/types`.
 *
 * The custom-functions surface (`@rebasepro/server/functions`) must bundle for
 * a runtime with no Node built-ins and imports nothing but `hono`, so its
 * guards cannot reach the canonical definitions in `@rebasepro/types`
 * (`ADMIN_ROLE`, `hasAdminRole`, `scopeGrants`). These are the same rules,
 * restated, and `test/admin-roles.test.ts` holds them equal.
 *
 * Everything else imports the `@rebasepro/types` versions.
 */

/** The one built-in role. It holds every scope. */
export const ADMIN_ROLE_NAME = "admin";

/** Does this list of roles include the admin role? */
export function holdsAdminRole(roles: readonly string[] | null | undefined): boolean {
    return !!roles?.includes(ADMIN_ROLE_NAME);
}

/**
 * Does a set of held scopes grant `scope`, optionally on one `target`? The
 * unqualified grant covers every target; `scope:target` covers its own.
 */
export function heldScopesGrant(held: readonly string[], scope: string, target?: string): boolean {
    for (const entry of held) {
        if (entry === scope) return true;
        if (target !== undefined && entry === `${scope}:${target}`) return true;
    }
    return false;
}
