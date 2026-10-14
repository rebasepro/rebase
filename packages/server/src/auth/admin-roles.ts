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
 * Everything else imports the `@rebasepro/types` versions — except
 * {@link scopeGuardProblem}, which both `requireScope` guards ask, so the root
 * one and the functions one refuse the same scope names in the same words.
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

/** Every scope Rebase defines (`BUILT_IN_SCOPES`), and what each takes as a target (`SCOPE_TARGETS`). */
const BUILT_IN_SCOPE_TARGETS: Readonly<Record<string, boolean>> = {
    "data:read": true,
    "data:write": true,
    "data:delete": true,
    "storage:read": true,
    "storage:write": true,
    "storage:delete": true,
    "functions:invoke": true,
    "users:read": false,
    "users:write": false,
    "schema:read": false,
    "schema:write": false,
    "database:read": false,
    "database:write": false,
    "backups:read": false,
    "cron:read": false,
    "cron:write": false,
    "logs:read": false,
    "keys:read": false,
    "keys:write": false
};

/** Every scope Rebase defines, in `BUILT_IN_SCOPES` order. */
export const BUILT_IN_SCOPE_NAMES: readonly string[] = Object.keys(BUILT_IN_SCOPE_TARGETS);

const SCOPE_PART = /^[a-z][a-z0-9-]*$/;

/**
 * Why a guard naming `scope` (and `target`, when it is fixed) could never
 * pass, or null when it could.
 *
 * Without `declared`, it judges what holds on every backend, so a guard can be
 * refused as it is registered: the name's shape, a target written into the
 * scope instead of passed beside it, a name under one of Rebase's own
 * resources that is not one of its scopes — the typo `data:raed` — and a
 * target on a built-in scope that takes none. With `declared`, the app scopes
 * the backend answering the request declares (`auth.scopes`), it also judges
 * an app scope, which nobody holds unless it is declared.
 */
export function scopeGuardProblem(scope: string, target?: string, declared?: readonly string[]): string | null {
    const call = target === undefined ? `requireScope("${scope}")` : `requireScope("${scope}", "${target}")`;
    const parts = typeof scope === "string" ? scope.split(":") : [];
    if (parts.length < 2 || !SCOPE_PART.test(parts[0]) || !SCOPE_PART.test(parts[1])) {
        return `${call}: "${scope}" is not a scope name. Name a scope resource:action, lower-case — ` +
            "\"users:read\", or one the app declares, such as \"project:deploy\".";
    }
    const name = `${parts[0]}:${parts[1]}`;
    if (parts.length > 2) {
        return `${call} writes a target into the scope. Pass it as the second argument: ` +
            `requireScope("${name}", "${parts.slice(2).join(":")}").`;
    }
    const builtIn = Object.prototype.hasOwnProperty.call(BUILT_IN_SCOPE_TARGETS, name);
    const resourceScopes = BUILT_IN_SCOPE_NAMES.filter(known => known.startsWith(`${parts[0]}:`));
    if (!builtIn && resourceScopes.length > 0) {
        return `${call}: "${name}" is not one of Rebase's scopes, so nobody could hold it. ` +
            `The ${parts[0]} scopes are ${resourceScopes.join(", ")}.`;
    }
    if (builtIn && target !== undefined && !BUILT_IN_SCOPE_TARGETS[name]) {
        return `${call}: "${name}" takes no target. Guard with requireScope("${name}").`;
    }
    if (!builtIn && declared && !declared.includes(name)) {
        return `${call}: this backend declares no "${name}" scope, so nobody holds it — an administrator neither. ` +
            `Declare it under auth.scopes on the users collection: "${name}": { label: "…" }.`;
    }
    return null;
}
