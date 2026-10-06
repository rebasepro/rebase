/**
 * Running a request as another user: the `x-rebase-impersonate` header, and
 * the `impersonate` field of the realtime socket's `AUTHENTICATE`.
 *
 * It exists for an administrator checking what one user can see and do — "can
 * B read A's rows, can B write them?" — against the real policies, from
 * Studio's API explorer and JS editor. A granted request runs as one of B's
 * own would: B's uid, B's roles as they are now, B's guest flag and the claims
 * a token minted for B now would carry reach `withAuth`, so the statement runs
 * as `rebase_user` with B's identity and every policy is evaluated for B.
 *
 * Who may: a signed-in administrator, on their own session, judged on their
 * roles as the database has them now rather than as their token claims. Never
 * an API key — not a personal key whose owner is an administrator either — and
 * never the service key. Impersonation is a person checking on another person,
 * and the audit line has to name one.
 *
 * Where: the data API, custom functions and the realtime socket. Every other
 * route refuses the header ({@link refuseUnhonouredImpersonation}).
 *
 * Fail closed: a request asking to act as someone either runs as the user it
 * names or is refused. It never runs as its caller, because that is the
 * failure this exists to end — a response showing the administrator's rows
 * under a label saying they were B's.
 *
 * @module
 */

import type { Context, MiddlewareHandler } from "hono";
import { hasAdminRole, IMPERSONATE_HEADER, type AuthenticatedUser, type DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import { scopeDataDriver } from "./rls-scope";
import { logger } from "../utils/logger";

/** How the caller authenticated, as far as impersonation is concerned. */
export type ImpersonationCredential = "session" | "api-key" | "service-key" | "none";

/** How the auth in use turns a uid into a request identity — `AuthAdapter.resolveUser`. */
export type ImpersonationUserResolver = (uid: string) => Promise<AuthenticatedUser | null>;

export interface ImpersonationRequest {
    /** The uid the request asked to act as, as sent. */
    requestedUid: string;
    /** What the caller presented. Only a `session` may impersonate. */
    credential: ImpersonationCredential;
    /** The caller, as their credential verified. */
    caller?: { uid: string; roles: readonly string[] };
    /** Absent when the auth in use has no `resolveUser`: then nobody may. */
    resolveUser?: ImpersonationUserResolver;
    /**
     * Where the request came in, for the security audit line — or absent to
     * write none, for a decision that only re-confirms one already logged
     * (the socket re-asks before every frame).
     */
    audit?: Record<string, unknown>;
}

/** The answer to a request to act as another user. */
export type ImpersonationDecision =
    | { granted: AuthenticatedUser; impersonator: string }
    | { refused: ApiError };

/** Why a request asking to impersonate was turned away, for the audit line. */
type Refusal = "malformed" | "api-key" | "service-key" | "anonymous" | "not-admin" | "unavailable" | "unknown-target";

const ADMIN_ONLY = "Only a signed-in administrator can run a request as another user.";

const NOT_A_PERSON: Record<"api-key" | "service-key" | "none", { reason: Refusal; message: string }> = {
    "api-key": {
        reason: "api-key",
        message: "An API key cannot run a request as another user. Send it with an administrator's session instead."
    },
    "service-key": {
        reason: "service-key",
        message: "The service key cannot run a request as another user. Send it with an administrator's session instead."
    },
    none: { reason: "anonymous", message: ADMIN_ONLY }
};

/**
 * Decide whether this caller may act as the user they named, and who that
 * user is now.
 *
 * The one decision both doors take — the HTTP data plane through
 * {@link applyImpersonation}, the realtime socket at `AUTHENTICATE` and before
 * every frame after it. The caller is judged before the named user is looked
 * up, so the answer to a caller who may not impersonate says nothing about
 * whether the uid exists.
 *
 * Throws when a lookup fails: that is not an answer about anyone, and each
 * door refuses it its own way.
 */
export async function decideImpersonation(request: ImpersonationRequest): Promise<ImpersonationDecision> {
    const { credential, caller, resolveUser, audit } = request;
    const targetUid = request.requestedUid.trim();

    const refuse = (reason: Refusal, error: ApiError): ImpersonationDecision => {
        if (audit) {
            logger.warn("[Security Audit] Refused a request to act as another user", {
                eventType: "auth.impersonation.refused",
                reason,
                callerUid: caller?.uid,
                requestedUid: targetUid,
                ...audit
            });
        }
        return { refused: error };
    };

    if (targetUid === "") {
        return refuse("malformed", ApiError.badRequest(
            `The ${IMPERSONATE_HEADER} header names no user. Send the uid of the user to act as, or leave the header out.`,
            "IMPERSONATION_INVALID"
        ));
    }

    if (credential !== "session") {
        const { reason, message } = NOT_A_PERSON[credential];
        return refuse(reason, ApiError.forbidden(message, "IMPERSONATION_FORBIDDEN"));
    }

    if (!caller || !hasAdminRole(caller.roles)) {
        return refuse("not-admin", ApiError.forbidden(ADMIN_ONLY, "IMPERSONATION_FORBIDDEN"));
    }

    if (!resolveUser) {
        return refuse("unavailable", new ApiError(501, "IMPERSONATION_UNAVAILABLE",
            "This backend's auth cannot run a request as another user: its auth adapter does not implement resolveUser."));
    }

    // The caller again, as the database has them now. The roles above came
    // from whatever verified the credential, which for a JWT may be a whole
    // token lifetime old — and a demoted administrator must not keep this.
    const self = await resolveUser(caller.uid);
    if (!self || !hasAdminRole(self.roles)) {
        return refuse("not-admin", ApiError.forbidden(ADMIN_ONLY, "IMPERSONATION_FORBIDDEN"));
    }

    const target = await resolveUser(targetUid);
    if (!target) {
        return refuse("unknown-target", ApiError.notFound(
            `No active user has the id "${targetUid}", so there is nobody to run this request as.`,
            "IMPERSONATION_TARGET_NOT_FOUND"
        ));
    }

    if (audit) {
        logger.info("[Security Audit] Ran a request as another user", {
            eventType: "auth.impersonation",
            impersonatorUid: caller.uid,
            targetUid: target.uid,
            targetRoles: target.roles,
            ...audit
        });
    }
    return { granted: target, impersonator: caller.uid };
}

export interface ImpersonationOptions {
    /** What the caller presented. Only a `session` may impersonate. */
    credential: ImpersonationCredential;
    /** The unscoped delegate the request's driver was scoped from. */
    driver: DataDriver;
    /** The auth adapter's `resolveUser`. Absent: the header is refused for everyone. */
    resolveUser?: ImpersonationUserResolver;
}

/** The caller the auth middleware put on the context, narrowed. */
function callerOf(c: Context<HonoEnv>): { uid: string; roles: string[] } | undefined {
    const user = c.get("user");
    if (typeof user !== "object" || user === null) return undefined;
    const uid = "uid" in user && typeof user.uid === "string" && user.uid !== "" ? user.uid : undefined;
    if (uid === undefined) return undefined;
    const roles = "roles" in user && Array.isArray(user.roles)
        ? user.roles.filter((role): role is string => typeof role === "string")
        : [];
    return { uid, roles };
}

/**
 * Honour or refuse this request's {@link IMPERSONATE_HEADER}.
 *
 * Called by the data-plane auth middlewares once the caller is on the context
 * and its driver is scoped. When the header names a user the caller may act
 * as, the context's `user` and `driver` are replaced with that user's and
 * `impersonator` names the caller.
 *
 * @returns The refusal to send, or `undefined` to carry on — as the caller
 *          when the header is absent, as the named user when it was granted.
 */
export async function applyImpersonation(
    c: Context<HonoEnv>,
    { credential, driver, resolveUser }: ImpersonationOptions
): Promise<Response | undefined> {
    const requested = c.req.header(IMPERSONATE_HEADER);
    if (requested === undefined) return undefined;

    const caller = callerOf(c);
    let decision: ImpersonationDecision;
    try {
        decision = await decideImpersonation({
            requestedUid: requested,
            credential,
            caller,
            resolveUser,
            audit: { door: "http", method: c.req.method, path: c.req.path, requestId: c.get("requestId") }
        });
    } catch (error: unknown) {
        // Refused, never run as the caller.
        return errorHandler(error instanceof Error ? error : new Error(String(error)), c) as Response;
    }
    if ("refused" in decision) return errorHandler(decision.refused, c) as Response;

    const target = decision.granted;
    const isAnonymous = target.isAnonymous === true;
    c.set("user", { uid: target.uid, email: target.email, roles: target.roles, isAnonymous });
    c.set("impersonator", { uid: decision.impersonator });
    try {
        c.set("driver", await scopeDataDriver(driver, {
            uid: target.uid,
            roles: target.roles,
            isAnonymous,
            ...(target.claims ? { claims: target.claims } : {})
        }));
    } catch (error: unknown) {
        logger.error("[AUTH] RLS scoping failed for an impersonated request", { error });
        return errorHandler(ApiError.internal("Internal authentication error"), c) as Response;
    }
    return undefined;
}

/**
 * Refuse {@link IMPERSONATE_HEADER} on every route that does not honour it.
 *
 * Only the data API and custom functions run a request as another user; the
 * rest — storage, auth, the admin surfaces — authenticate the caller and
 * ignore the header. Ignored, a request asking to act as B would be answered
 * as the administrator who sent it, which is the one outcome impersonation
 * must never have. Mounted ahead of every route, so a surface added later is
 * refused until it is listed here as honouring the header.
 *
 * @param honouredMounts - The mount points whose auth middleware applies the
 *        header (`/api/data`, `/api/functions`). A path is under one when it
 *        is the mount itself or continues it with a `/`.
 */
export function refuseUnhonouredImpersonation(honouredMounts: readonly string[]): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        if (c.req.header(IMPERSONATE_HEADER) === undefined) return next();
        const path = c.req.path;
        if (honouredMounts.some(mount => path === mount || path.startsWith(`${mount}/`))) return next();
        logger.warn("[Security Audit] Refused a request to act as another user", {
            eventType: "auth.impersonation.refused",
            reason: "unsupported-route",
            method: c.req.method,
            path,
            requestId: c.get("requestId")
        });
        return errorHandler(ApiError.badRequest(
            `This route cannot run as another user, so it refuses the ${IMPERSONATE_HEADER} header. ` +
            "Only the data API and custom functions honour it.",
            "IMPERSONATION_UNSUPPORTED"
        ), c) as Response;
    };
}
