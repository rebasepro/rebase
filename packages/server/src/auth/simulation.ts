/**
 * The RLS simulator: an administrator's data-plane request run as a role, a
 * user or a service key — `x-rebase-simulate-role`, `x-rebase-simulate-user-id`
 * and `x-rebase-simulate-api-key-id`.
 *
 * Impersonation ({@link ./impersonation}) answers "what does this person see";
 * this answers the question an author asks while writing policies, before any
 * such person exists: "what does a `customer` see, what does `u_1` holding
 * `customer` see, what does the support agent's key see". So a role need not be
 * held by anyone and a uid sent with a role need not name an account. Nothing
 * here widens what the caller could do: the caller is an administrator, whom
 * the default policies already let read and write every row, and every
 * simulated identity is narrower.
 *
 * The identity reaches the database exactly as a real caller's does —
 * `scopeDataDriver` → `withAuth` → `applyAuthContext`, which sets the
 * transaction-local identity (`app.uid`, `app.roles`, `app.jwt`) and switches to
 * `rebase_user`, so every policy is evaluated for it. A simulated key also
 * carries its scopes, so the data API refuses the collections the key cannot
 * reach, as it would refuse the key. Fields the identity's roles cannot read
 * are stripped by the driver as for any caller; {@link reportSimulatedContext}
 * names them on the response.
 *
 * Who may: a signed-in administrator on their own session, judged on their
 * roles as the database has them now. Never an API key, never the service
 * key, never anyone else — a 403, never an answer as themselves.
 *
 * Where: the data API and custom functions, like impersonation. Every other
 * route refuses the headers (`refuseUnhonouredImpersonation`).
 *
 * Read-only: a write, delete, batch, revert or non-GET function call that
 * carries the headers is refused (`SIMULATION_READ_ONLY`, see
 * {@link ./simulation-read-only}) rather than run as the simulated identity.
 *
 * Not simulated: the API-level `requireAuth` gate. A simulated anonymous
 * caller is let past it, so the answer is what the rows' policies give an
 * anonymous caller — a 401 there would send the admin panel to refresh a
 * session that is fine.
 *
 * @module
 */

import type { Context, MiddlewareHandler } from "hono";
import {
    ANONYMOUS_USER_ID,
    formatSimulatedContext,
    hasAdminRole,
    IMPERSONATE_HEADER,
    SIMULATE_API_KEY_ID_HEADER,
    SIMULATE_ROLE_HEADER,
    SIMULATE_USER_ID_HEADER,
    SIMULATED_CONTEXT_HEADER,
    type AccessSimulation,
    type ApiKeyMasked,
    type CollectionConfig,
    type DataDriver
} from "@rebasepro/types";
import { apiHiddenFieldNames, restrictedFieldNames } from "@rebasepro/common";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import { scopeDataDriver } from "./rls-scope";
import type { ImpersonationCredential, ImpersonationUserResolver } from "./impersonation";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import { identityOfKey } from "./api-keys/api-key-middleware";
import { accessOf, type AccessControl } from "./access";
import { logger } from "../utils/logger";

/**
 * The uid a role simulated on its own runs as: a valid UUID that no row
 * names, so an ownership policy matches nothing and a policy comparing a
 * `uuid` column to `auth.uid()` still casts cleanly.
 */
export const SIMULATED_NOBODY_UID = "00000000-0000-0000-0000-000000000000";

/** Roles that mean "no session at all". */
const ANONYMOUS_ROLES: ReadonlySet<string> = new Set(["anon", "anonymous"]);

/** Who a granted simulation runs as. */
export interface SimulatedIdentity {
    uid: string;
    roles: string[];
    isAnonymous: boolean;
    claims?: Record<string, unknown>;
    /** A key's scopes. Absent for a person, whose data plane is RLS's to decide. */
    scopes?: string[];
    apiKey?: ApiKeyMasked;
    /** What the response header names: the role (or roles) and the uid. */
    role: string;
}

export interface SimulationRequest {
    simulation: AccessSimulation;
    /** What the caller presented. Only a `session` may simulate. */
    credential: ImpersonationCredential;
    caller?: { uid: string; roles: readonly string[] };
    /** Re-reads the caller's roles, and finds a user named without a role. */
    resolveUser?: ImpersonationUserResolver;
    /** Finds a key named by id. Absent: a key simulation is refused. */
    apiKeyStore?: ApiKeyStore;
    /** Whose access model a personal key's owner is judged against. */
    access?: AccessControl;
    /** Where the request came in, for the audit line; absent writes none. */
    audit?: Record<string, unknown>;
}

export type SimulationDecision =
    | { granted: SimulatedIdentity; simulator: string }
    | { refused: ApiError };

const ADMIN_ONLY = "Only a signed-in administrator can simulate another role, user or API key.";

/** Read the three simulation headers, or `undefined` when none was sent. */
export function simulationOf(header: (name: string) => string | undefined): AccessSimulation | undefined {
    const role = header(SIMULATE_ROLE_HEADER);
    const userId = header(SIMULATE_USER_ID_HEADER);
    const apiKeyId = header(SIMULATE_API_KEY_ID_HEADER);
    if (role === undefined && userId === undefined && apiKeyId === undefined) return undefined;
    return {
        ...(role !== undefined ? { role } : {}),
        ...(userId !== undefined ? { userId } : {}),
        ...(apiKeyId !== undefined ? { apiKeyId } : {})
    };
}

/** Whether a request carries any simulation header. */
export function carriesSimulation(header: (name: string) => string | undefined): boolean {
    return simulationOf(header) !== undefined;
}

/**
 * Decide whether this caller may simulate what they asked for, and who the
 * request then runs as.
 *
 * The caller is judged before anything they named is looked up, so a refusal
 * says nothing about whether a user or key exists. Throws when a lookup fails.
 */
export async function decideSimulation(request: SimulationRequest): Promise<SimulationDecision> {
    const { credential, caller, resolveUser, apiKeyStore, audit } = request;
    const role = request.simulation.role?.trim();
    const userId = request.simulation.userId?.trim();
    const apiKeyId = request.simulation.apiKeyId?.trim();

    const refuse = (reason: string, error: ApiError): SimulationDecision => {
        if (audit) {
            logger.warn("[Security Audit] Refused a request to simulate access", {
                eventType: "auth.simulation.refused",
                reason,
                callerUid: caller?.uid,
                simulation: request.simulation,
                ...audit
            });
        }
        return { refused: error };
    };

    if (role === "" || userId === "" || apiKeyId === "") {
        return refuse("malformed", ApiError.badRequest(
            "A simulation header was sent empty. Name a role, a user id or an API key id, or leave the header out.",
            "SIMULATION_INVALID"
        ));
    }
    if (apiKeyId !== undefined && (role !== undefined || userId !== undefined)) {
        return refuse("malformed", ApiError.badRequest(
            `${SIMULATE_API_KEY_ID_HEADER} runs as the key's own identity and roles, so it cannot be combined ` +
            `with ${SIMULATE_ROLE_HEADER} or ${SIMULATE_USER_ID_HEADER}.`,
            "SIMULATION_INVALID"
        ));
    }

    if (credential !== "session" || !caller || !hasAdminRole(caller.roles)) {
        return refuse(credential === "session" ? "not-admin" : credential,
            ApiError.forbidden(ADMIN_ONLY, "SIMULATION_FORBIDDEN"));
    }
    if (!resolveUser) {
        return refuse("unavailable", new ApiError(501, "SIMULATION_UNAVAILABLE",
            "This backend's auth cannot confirm an administrator's roles: its auth adapter does not implement resolveUser."));
    }
    // The caller as the database has them now: a token's roles may be a whole
    // token lifetime old, and a demoted administrator must not keep this.
    const self = await resolveUser(caller.uid);
    if (!self || !hasAdminRole(self.roles)) {
        return refuse("not-admin", ApiError.forbidden(ADMIN_ONLY, "SIMULATION_FORBIDDEN"));
    }

    let identity: SimulatedIdentity;
    if (apiKeyId !== undefined) {
        if (!apiKeyStore) {
            return refuse("unavailable", new ApiError(501, "SIMULATION_UNAVAILABLE",
                "This backend has no API keys to simulate."));
        }
        const key = await apiKeyStore.getApiKeyById(apiKeyId);
        const keyIdentity = key ? await identityOfKey(key, request.access) : undefined;
        if (!key || !keyIdentity || !("uid" in keyIdentity)) {
            return refuse("unknown-target", ApiError.notFound(
                `No active API key has the id "${apiKeyId}", so there is nothing to simulate.`,
                "SIMULATION_TARGET_NOT_FOUND"
            ));
        }
        identity = {
            uid: keyIdentity.uid,
            roles: keyIdentity.roles,
            isAnonymous: false,
            scopes: keyIdentity.scopes,
            apiKey: key,
            role: keyIdentity.roles.join(",")
        };
    } else if (role !== undefined) {
        const anonymous = ANONYMOUS_ROLES.has(role) && userId === undefined;
        identity = anonymous
            ? { uid: ANONYMOUS_USER_ID, roles: ["anon"], isAnonymous: false, role }
            : { uid: userId ?? SIMULATED_NOBODY_UID, roles: [role], isAnonymous: false, role };
    } else {
        // A uid with no role: an account, as it is now.
        const target = userId === undefined ? null : await resolveUser(userId);
        if (!target) {
            return refuse("unknown-target", ApiError.notFound(
                `No active user has the id "${userId ?? ""}". Send ${SIMULATE_ROLE_HEADER} as well to simulate a uid ` +
                "that has no account.",
                "SIMULATION_TARGET_NOT_FOUND"
            ));
        }
        identity = {
            uid: target.uid,
            roles: target.roles,
            isAnonymous: target.isAnonymous === true,
            ...(target.claims ? { claims: target.claims } : {}),
            role: target.roles.join(",")
        };
    }

    if (audit) {
        logger.info("[Security Audit] Ran a request with simulated access", {
            eventType: "auth.simulation",
            simulatorUid: caller.uid,
            targetUid: identity.uid,
            targetRoles: identity.roles,
            ...(identity.apiKey ? { apiKeyId: identity.apiKey.id } : {}),
            ...audit
        });
    }
    return { granted: identity, simulator: caller.uid };
}

export interface SimulationOptions {
    credential: ImpersonationCredential;
    /** The unscoped delegate the request's driver was scoped from. */
    driver: DataDriver;
    resolveUser?: ImpersonationUserResolver;
    apiKeyStore?: ApiKeyStore;
}

/** The caller the auth middleware put on the context, narrowed. */
export function callerOf(c: Context<HonoEnv>): { uid: string; roles: string[] } | undefined {
    const user = c.get("user");
    if (typeof user !== "object" || user === null) return undefined;
    const uid = "uid" in user && typeof user.uid === "string" && user.uid !== "" ? user.uid : undefined;
    if (uid === undefined) return undefined;
    const roles = "roles" in user && Array.isArray(user.roles)
        ? user.roles.filter((entry): entry is string => typeof entry === "string")
        : [];
    return { uid, roles };
}

/**
 * Honour or refuse this request's simulation headers.
 *
 * Called by the data-plane auth middlewares once the caller is on the context
 * and before impersonation, which it excludes. On a grant the context's
 * `user`, `driver`, `scopes` and `apiKey` become the simulated identity's,
 * `impersonator` names the administrator for the request log, and
 * `simulation` records what to report on the response.
 *
 * @returns The refusal to send, or `undefined` to carry on.
 */
export async function applySimulation(
    c: Context<HonoEnv>,
    { credential, driver, resolveUser, apiKeyStore }: SimulationOptions
): Promise<Response | undefined> {
    const simulation = simulationOf(name => c.req.header(name));
    if (simulation === undefined) return undefined;

    if (c.req.header(IMPERSONATE_HEADER) !== undefined) {
        return errorHandler(ApiError.badRequest(
            `A request either impersonates a user (${IMPERSONATE_HEADER}) or simulates access, not both.`,
            "SIMULATION_INVALID"
        ), c) as Response;
    }

    let decision: SimulationDecision;
    try {
        decision = await decideSimulation({
            simulation,
            credential,
            caller: callerOf(c),
            resolveUser,
            apiKeyStore,
            access: accessOf(c),
            audit: { door: "http", method: c.req.method, path: c.req.path, requestId: c.get("requestId") }
        });
    } catch (error: unknown) {
        // Refused, never run as the caller.
        return errorHandler(error instanceof Error ? error : new Error(String(error)), c) as Response;
    }
    if ("refused" in decision) return errorHandler(decision.refused, c) as Response;

    const identity = decision.granted;
    c.set("user", { uid: identity.uid, roles: identity.roles, isAnonymous: identity.isAnonymous });
    c.set("impersonator", { uid: decision.simulator });
    c.set("scopes", identity.scopes);
    c.set("apiKey", identity.apiKey);
    c.set("simulation", {
        role: identity.role,
        sub: identity.uid,
        roles: identity.roles,
        ...(identity.apiKey ? { apiKeyId: identity.apiKey.id } : {})
    });
    try {
        c.set("driver", await scopeDataDriver(driver, {
            uid: identity.uid,
            roles: identity.roles,
            isAnonymous: identity.isAnonymous,
            ...(identity.claims ? { claims: identity.claims } : {})
        }));
    } catch (error: unknown) {
        logger.error("[AUTH] RLS scoping failed for a simulated request", { error });
        return errorHandler(ApiError.internal("Internal authentication error"), c) as Response;
    }
    return undefined;
}

/**
 * The fields of `collection` the roles cannot read: what the driver strips
 * from every row it hands them. Fields hidden from everyone (`excludeFromApi`)
 * are left out — no role sees those, so they say nothing about this one.
 */
export function maskedFieldsFor(collection: CollectionConfig, roles: readonly string[]): string[] {
    const hiddenFromAll = apiHiddenFieldNames(collection);
    return restrictedFieldNames(collection, { roles }, "read").declared
        .filter(name => !hiddenFromAll.has(name));
}

/**
 * Name what a simulated request ran as on its response
 * ({@link SIMULATED_CONTEXT_HEADER}), refusals included.
 *
 * Mounted ahead of the data-plane groups; it reads, after the request is
 * answered, what {@link applySimulation} and the REST generator recorded on
 * the context — the identity, and which collection the request was about.
 */
export function reportSimulatedContext(): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        await next();
        const simulation = c.get("simulation");
        if (!simulation) return;
        const slug = c.get("collection");
        const collection = slug ? c.get("services")?.collections().find(entry => entry.slug === slug) : undefined;
        const value = formatSimulatedContext({
            role: simulation.role,
            sub: simulation.sub,
            maskedColumns: collection ? maskedFieldsFor(collection, simulation.roles) : [],
            ...(simulation.apiKeyId ? { apiKeyId: simulation.apiKeyId } : {}),
            ...(slug ? { collection: slug } : {})
        });
        try {
            c.res.headers.set(SIMULATED_CONTEXT_HEADER, value);
        } catch {
            // An immutable response (a proxied fetch) keeps its headers.
        }
    };
}
