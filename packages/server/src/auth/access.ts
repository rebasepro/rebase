/**
 * The access model this backend serves, and the one gate every scope check
 * goes through.
 *
 * The model — the app's declared roles and scopes beside the built-in ones —
 * comes from the users collection's `auth` block and is configured once at
 * boot, like the JWT keys. A process serves one backend's auth, so one model.
 *
 * Who holds what:
 *
 * - A credential that narrows its person — an API key, an MCP token — puts
 *   its scopes in the request context (`c.set("scopes", …)`) when it is
 *   verified. That list is the whole answer for it.
 * - Anyone else is a person (or the service key, which is the `admin` role),
 *   and holds what their roles hold: `scopesForRoles`.
 *
 * @module
 */

import type { Context, MiddlewareHandler } from "hono";
import {
    ADMIN_ROLE,
    ADMIN_SCOPES,
    BUILT_IN_SCOPES,
    EMPTY_ACCESS_MODEL,
    hasAdminRole,
    isDataPlaneScope,
    parseScope,
    scopeGrants,
    scopesBeyond,
    scopesForRoles,
    validateScopes,
    type AccessModel,
    type CollectionConfig,
    type RoleDefinition,
    type ScopeDefinition
} from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError } from "../api/errors";
import { refuse } from "./middleware";

/** The account a personal key acts as, as it is now. Null when it no longer exists. */
export type KeyOwnerResolver = (uid: string) => Promise<{ roles: string[] } | null>;

let configured: AccessModel = EMPTY_ACCESS_MODEL;
let keyOwners: KeyOwnerResolver | undefined;

/** The access model the running backend serves. Built-ins only until boot configures it. */
export function getAccessModel(): AccessModel {
    return configured;
}

/**
 * How a personal key finds its owner, or undefined when personal keys are
 * off — in which case every personal key, however valid, is refused.
 */
export function getKeyOwnerResolver(): KeyOwnerResolver | undefined {
    return keyOwners;
}

/**
 * Install the access model, and — when the app enables `auth.personalKeys`
 * and has an account store to read owners from — how personal keys find
 * their owner. Called once by `initializeRebaseBackend`.
 */
export function configureAccess(options: { model: AccessModel; resolveKeyOwner?: KeyOwnerResolver }): void {
    configured = options.model;
    keyOwners = options.resolveKeyOwner;
}

/** The resource names Rebase's own scopes use; an app scope may not reuse one. */
const BUILT_IN_RESOURCES = new Set(BUILT_IN_SCOPES.map(scope => scope.slice(0, scope.indexOf(":"))));

/** A declaration the access model cannot be built from. Fails the boot. */
export class AccessModelError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AccessModelError";
    }
}

/**
 * Build the access model from the users collection's `auth` block, refusing
 * anything that would read as a grant it is not.
 *
 * - `admin` may not be declared: it is built in and holds everything, and a
 *   declaration would either repeat that or quietly narrow it.
 * - An app scope may not reuse a built-in resource name (`logs:export`): the
 *   built-in resources are Rebase's, and a reader of `logs:*` should not have
 *   to know which half is whose.
 * - A role may not list a data-plane scope: a person's data access is the
 *   collection's `securityRules`, so `data:write` on a role would grant nothing
 *   and look like it granted something.
 */
export function accessModelFromCollections(collections: readonly CollectionConfig[]): AccessModel {
    const authCollection = collections.find(collection => {
        const auth = collection.auth;
        return auth === true || (!!auth && typeof auth === "object" && auth.enabled === true);
    });
    const auth = authCollection && typeof authCollection.auth === "object" ? authCollection.auth : undefined;
    const declaredScopes: Record<string, ScopeDefinition> = { ...(auth?.scopes ?? {}) };
    const declaredRoles: Record<string, RoleDefinition> = { ...(auth?.roles ?? {}) };
    const where = `the "${authCollection?.slug ?? "users"}" collection's auth block`;

    for (const [name, definition] of Object.entries(declaredScopes)) {
        const parsed = parseScope(name);
        if (!parsed || parsed.target !== undefined) {
            throw new AccessModelError(
                `auth.scopes: "${name}" in ${where} is not a scope name. Name scopes resource:action, ` +
                "lower-case, without a target — for example \"project:deploy\".");
        }
        const resource = name.slice(0, name.indexOf(":"));
        if (BUILT_IN_RESOURCES.has(resource)) {
            throw new AccessModelError(
                `auth.scopes: "${name}" in ${where} uses the built-in resource "${resource}". ` +
                `App scopes need their own resource name; the built-in ones are ${[...BUILT_IN_RESOURCES].join(", ")}.`);
        }
        if (typeof definition?.label !== "string" || definition.label.trim() === "") {
            throw new AccessModelError(`auth.scopes: "${name}" in ${where} needs a label — it is what a person granting it reads.`);
        }
    }

    const model: AccessModel = { roles: declaredRoles, scopes: declaredScopes };

    for (const [role, definition] of Object.entries(declaredRoles)) {
        if (role === ADMIN_ROLE) {
            throw new AccessModelError(
                `auth.roles: "admin" in ${where} is built in — it holds every scope — and cannot be declared. ` +
                "Declare a role with another name for a narrower set.");
        }
        if (!Array.isArray(definition?.scopes)) {
            throw new AccessModelError(`auth.roles: "${role}" in ${where} needs a scopes list.`);
        }
        const dataPlane = definition.scopes.filter(scope => isDataPlaneScope(parseScope(scope)?.scope ?? ""));
        if (dataPlane.length > 0) {
            throw new AccessModelError(
                `auth.roles: "${role}" in ${where} lists ${dataPlane.join(", ")}. ` +
                "Every signed-in person already holds the data plane; what they may do with rows is the " +
                "collection's securityRules. List admin-plane and app scopes only.");
        }
        const problems = validateScopes(definition.scopes, model);
        if (problems.length > 0) {
            throw new AccessModelError(
                `auth.roles: "${role}" in ${where} lists ${problems.map(p => `"${p.scope}" (${p.reason})`).join(", ")}. ` +
                `Role scopes are ${ADMIN_SCOPES.join(", ")} and the app's own auth.scopes.`);
        }
    }

    return model;
}

/** Narrow a context's user to the roles it carries. */
function rolesOf(user: unknown): string[] {
    if (typeof user !== "object" || user === null || !("roles" in user)) return [];
    const roles = user.roles;
    return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string") : [];
}

/**
 * Everything the caller of this request may do. Empty for a request with no
 * caller.
 */
export function callerScopes(c: Context<HonoEnv>): string[] {
    const narrowed = c.get("scopes");
    if (narrowed) return narrowed;
    const user = c.get("user");
    if (!user) return [];
    return scopesForRoles(rolesOf(user), configured);
}

/** Does this request's caller hold `scope`, on `target` when one is given? */
export function hasScope(c: Context<HonoEnv>, scope: string, target?: string): boolean {
    return scopeGrants(callerScopes(c), scope, target);
}

/**
 * The refusal for a missing scope, worded for whoever is holding the
 * credential. `details.requiredScope` names it for clients that branch.
 */
export function scopeMissing(c: Context<HonoEnv>, scope: string, target?: string): ApiError {
    const wanted = target !== undefined ? `${scope}:${target}` : scope;
    const viaKey = c.get("apiKey") !== undefined;
    const message = viaKey
        ? `This API key does not hold the "${wanted}" scope. Create a key that includes it.`
        : c.get("scopes")
            ? `This token does not hold the "${wanted}" scope. Reconnect and grant it.`
            : `Your account does not hold the "${wanted}" scope. A role that lists it (auth.roles on the users collection) grants it; the admin role holds every scope.`;
    return new ApiError(403, "SCOPE_MISSING", message, { requiredScope: wanted });
}

/**
 * Refuse a request whose caller does not hold `scope`.
 *
 * `target` narrows the check to one collection, bucket, function or app
 * resource, and may be read from the request. Mount after authentication: a
 * request with no caller is refused as unauthenticated, not as unscoped.
 *
 * @example
 * ```ts
 * app.post("/deploy/:project", requireScope("project:deploy", c => c.req.param("project")), handler);
 * ```
 */
export function requireScope(
    scope: string,
    target?: string | ((c: Context<HonoEnv>) => string | undefined)
): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        if (!c.get("user")) {
            return refuse(c, ApiError.unauthenticated("Authentication required"));
        }
        const resolvedTarget = typeof target === "function" ? target(c) : target;
        if (!hasScope(c, scope, resolvedTarget)) {
            return refuse(c, scopeMissing(c, scope, resolvedTarget));
        }
        return next();
    };
}

/**
 * Refuse a request unless its caller holds the scope for its HTTP method:
 * `read` for GET and HEAD, `write` for everything else. For an admin surface
 * whose reads and writes split exactly along the method.
 */
export function requireScopeByMethod(scopes: { read: string; write: string }): MiddlewareHandler<HonoEnv> {
    const read = requireScope(scopes.read);
    const write = requireScope(scopes.write);
    return async (c, next) => {
        const method = c.req.method.toUpperCase();
        return (method === "GET" || method === "HEAD" ? read : write)(c, next);
    };
}

/**
 * What a set of roles holds beyond this request's caller — the scopes, plus
 * `admin` itself when the roles include it and the caller does not hold it.
 * Empty when the caller covers every one.
 *
 * `admin` is named separately because it is more than its scopes: it is the
 * RLS role that reads every row, so a role listing every admin-plane scope
 * still cannot hand it out.
 */
function beyondCaller(c: Context<HonoEnv>, roles: readonly string[]): string[] {
    const beyond = scopesBeyond(scopesForRoles(roles, configured), callerScopes(c));
    if (hasAdminRole(roles) && !hasAdminRole(rolesOf(c.get("user")))) beyond.unshift(ADMIN_ROLE);
    return beyond;
}

/**
 * Refuse to let the caller act on an account — edit it, reset its password,
 * delete it — when that account holds anything the caller does not.
 *
 * `users:write` is the scope that lets a support role manage accounts, and
 * without this it would also let that role reset an administrator's password
 * and sign in as them.
 */
export function assertMayManageAccount(c: Context<HonoEnv>, targetRoles: readonly string[]): void {
    const beyond = beyondCaller(c, targetRoles);
    if (beyond.length > 0) {
        throw new ApiError(403, "ACCOUNT_OUTRANKS_CALLER",
            `This account holds ${beyond.join(", ")}, which you do not, so you cannot change it.`,
            { beyond });
    }
}

/** Refuse to let the caller grant roles that hold anything the caller does not. */
export function assertMayGrantRoles(c: Context<HonoEnv>, roles: readonly string[]): void {
    const beyond = beyondCaller(c, roles);
    if (beyond.length > 0) {
        throw new ApiError(403, "ROLE_EXCEEDS_CALLER",
            `These roles hold ${beyond.join(", ")}, which you do not, so you cannot grant them.`,
            { beyond });
    }
}
