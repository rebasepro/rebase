/**
 * The access model this backend serves, and the one gate every scope check
 * goes through.
 *
 * The model — the app's declared roles and scopes beside the built-in ones —
 * comes from the users collection's `auth` block. Each backend holds its own
 * ({@link AccessControl}) and its route groups put it on the request, so the
 * checks below judge a caller against the backend answering them.
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
import type { AuthRepository } from "./interfaces";

/** The account a personal key acts as, as it is now. Null when it no longer exists. */
export type KeyOwnerResolver = (uid: string) => Promise<{ roles: string[] } | null>;

/**
 * How a personal key finds its owner in an account store: the account as it
 * is now — a missing or disabled one is no owner — and its roles.
 *
 * One read where the store answers both at once: `getAccountAccessState`, the
 * statement every access token is already judged against, which reads roles
 * and `disabled_at` together. Otherwise the account, then its roles — the two
 * reads this always made, one round trip more per request.
 */
export function keyOwnerResolverFor(
    repo: Pick<AuthRepository, "getUserById" | "getUserRoleIds" | "getAccountAccessState">
): KeyOwnerResolver {
    if (typeof repo.getAccountAccessState === "function") {
        const readAccount = repo.getAccountAccessState.bind(repo);
        return async (uid) => {
            const account = await readAccount(uid);
            // A disabled owner's keys stop with them.
            if (!account || account.disabled) return null;
            return { roles: account.roles };
        };
    }
    return async (uid) => {
        const user = await repo.getUserById(uid);
        if (!user || user.disabled) return null;
        return { roles: await repo.getUserRoleIds(uid) };
    };
}

/**
 * One backend's access model — the app's declared roles and scopes beside the
 * built-in ones — and, when `auth.personalKeys` is on and the backend has an
 * account store to read owners from, how a personal key finds its owner.
 *
 * Every backend holds its own (`backend.services.access`), so a role one
 * backend declares grants nothing on another in the same process.
 */
export interface AccessControl {
    readonly model: AccessModel;
    /**
     * How a personal key finds its owner, or undefined when personal keys are
     * off — in which case every personal key, however valid, is refused.
     */
    readonly resolveKeyOwner?: KeyOwnerResolver;
}

/**
 * What the module-level API answers for: {@link getAccessModel},
 * {@link getKeyOwnerResolver}, and every scope check on a route mounted
 * outside any backend. Built-ins only until {@link configureAccess} or a
 * backend installed as the process default sets it.
 */
let processAccess: AccessControl = { model: EMPTY_ACCESS_MODEL };

/** The process default's access model. Built-ins only until one is configured. */
export function getAccessModel(): AccessModel {
    return processAccess.model;
}

/**
 * How a personal key finds its owner in the process default, or undefined
 * when personal keys are off there.
 */
export function getKeyOwnerResolver(): KeyOwnerResolver | undefined {
    return processAccess.resolveKeyOwner;
}

/**
 * Set the process default's access model, and — when the app enables
 * `auth.personalKeys` and has an account store to read owners from — how
 * personal keys find their owner. For a test, or a server wired by hand that
 * uses the module-level API; a backend built by `createRebaseBackend` carries
 * its own.
 */
export function configureAccess(options: { model: AccessModel; resolveKeyOwner?: KeyOwnerResolver }): void {
    processAccess = { model: options.model, resolveKeyOwner: options.resolveKeyOwner };
}

/** @internal The process default itself, to install another or to restore it. */
export function defaultAccessControl(): AccessControl {
    return processAccess;
}

/** @internal See {@link defaultAccessControl}. */
export function setDefaultAccessControl(access: AccessControl): void {
    processAccess = access;
}

/**
 * The process default as an {@link AccessControl} that follows it — what a
 * route or a key check built outside any backend falls back to.
 */
export const processAccessControl: AccessControl = {
    get model() {
        return processAccess.model;
    },
    get resolveKeyOwner() {
        return processAccess.resolveKeyOwner;
    }
};

/**
 * The access control serving this request: the backend's whose route group is
 * answering it, or the process default for a route mounted outside any.
 */
export function accessOf(c: Context<HonoEnv>): AccessControl {
    return c.get("services")?.access ?? processAccessControl;
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
    return scopesForRoles(rolesOf(user), accessOf(c).model);
}

/**
 * Whether this request's caller holds the `admin` role. The service key signs
 * in as one.
 */
export function callerIsAdmin(c: Context<HonoEnv>): boolean {
    return hasAdminRole(rolesOf(c.get("user")));
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
    const beyond = scopesBeyond(scopesForRoles(roles, accessOf(c).model), callerScopes(c));
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
