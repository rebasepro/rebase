/**
 * Running a data-plane request as another user: the `x-rebase-impersonate`
 * header.
 *
 * It exists for an administrator checking what one user can see and do — "can
 * B read A's rows, can B write them?" — against the real policies, from
 * Studio's API explorer. A granted request runs as one of B's own would: B's
 * uid, B's roles as they are now, B's guest flag and the claims a token minted
 * for B now would carry reach `withAuth`, so the statement runs as
 * `rebase_user` with B's identity and every policy is evaluated for B.
 *
 * Who may: a signed-in administrator, on their own session, judged on their
 * roles as the database has them now rather than as their token claims. Never
 * an API key — not a personal key whose owner is an administrator either — and
 * never the service key. Impersonation is a person checking on another person,
 * and the audit line has to name one.
 *
 * Fail closed: a request carrying the header either runs as the user it names
 * or is refused. It never runs as its caller, because that is the failure this
 * exists to end — a response showing the administrator's rows under a label
 * saying they were B's.
 *
 * @module
 */

import type { Context } from "hono";
import { hasAdminRole, IMPERSONATE_HEADER, type AuthenticatedUser, type DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import { scopeDataDriver } from "./rls-scope";
import { logger } from "../utils/logger";

/** How the request's caller authenticated, as far as impersonation is concerned. */
export type ImpersonationCredential = "session" | "api-key" | "service-key" | "none";

export interface ImpersonationOptions {
    /** What the caller presented. Only a `session` may impersonate. */
    credential: ImpersonationCredential;
    /** The unscoped delegate the request's driver was scoped from. */
    driver: DataDriver;
    /**
     * How the auth in use turns a uid into a request identity — the auth
     * adapter's `resolveUser`. Absent when it has none, and then the header is
     * refused for everyone.
     */
    resolveUser?: (uid: string) => Promise<AuthenticatedUser | null>;
}

/** Why a request asking to impersonate was turned away, for the audit line. */
type Refusal = "malformed" | "api-key" | "service-key" | "anonymous" | "not-admin" | "unavailable" | "unknown-target";

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

function refuse(c: Context<HonoEnv>, reason: Refusal, requestedUid: string, error: ApiError): Response {
    logger.warn("[Security Audit] Refused a request to act as another user", {
        eventType: "auth.impersonation.refused",
        reason,
        callerUid: callerOf(c)?.uid,
        requestedUid,
        method: c.req.method,
        path: c.req.path,
        requestId: c.get("requestId")
    });
    return errorHandler(error, c) as Response;
}

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
 * Honour or refuse this request's {@link IMPERSONATE_HEADER}.
 *
 * Called by the data-plane auth middlewares once the caller is on the context
 * and its driver is scoped. When the header names a user the caller may act
 * as, the context's `user` and `driver` are replaced with that user's and
 * `impersonator` names the caller.
 *
 * The caller is judged before the named user is looked up, so the answer to a
 * caller who may not impersonate says nothing about whether the uid exists.
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

    const targetUid = requested.trim();
    if (targetUid === "") {
        return refuse(c, "malformed", requested, ApiError.badRequest(
            `The ${IMPERSONATE_HEADER} header names no user. Send the uid of the user to act as, or leave the header out.`,
            "IMPERSONATION_INVALID"
        ));
    }

    if (credential !== "session") {
        const { reason, message } = NOT_A_PERSON[credential];
        return refuse(c, reason, targetUid, ApiError.forbidden(message, "IMPERSONATION_FORBIDDEN"));
    }

    const caller = callerOf(c);
    if (!caller || !hasAdminRole(caller.roles)) {
        return refuse(c, "not-admin", targetUid, ApiError.forbidden(ADMIN_ONLY, "IMPERSONATION_FORBIDDEN"));
    }

    if (!resolveUser) {
        return refuse(c, "unavailable", targetUid, new ApiError(501, "IMPERSONATION_UNAVAILABLE",
            "This backend's auth cannot run a request as another user: its auth adapter does not implement resolveUser."));
    }

    let target: AuthenticatedUser | null;
    try {
        // The caller again, as the database has them now. The roles above came
        // from whatever verified the session, which for a JWT may be a whole
        // token lifetime old — and a demoted administrator must not keep this.
        const self = await resolveUser(caller.uid);
        if (!self || !hasAdminRole(self.roles)) {
            return refuse(c, "not-admin", targetUid, ApiError.forbidden(ADMIN_ONLY, "IMPERSONATION_FORBIDDEN"));
        }
        target = await resolveUser(targetUid);
    } catch (error: unknown) {
        // A lookup that failed is not an answer about anyone: refused, never
        // run as the caller. A malformed uid arrives here as the database's
        // data exception, which the handler answers as a 400 naming it.
        return errorHandler(error instanceof Error ? error : new Error(String(error)), c) as Response;
    }

    if (!target) {
        return refuse(c, "unknown-target", targetUid, ApiError.notFound(
            `No active user has the id "${targetUid}", so there is nobody to run this request as.`,
            "IMPERSONATION_TARGET_NOT_FOUND"
        ));
    }

    const isAnonymous = target.isAnonymous === true;
    c.set("user", { uid: target.uid, email: target.email, roles: target.roles, isAnonymous });
    c.set("impersonator", { uid: caller.uid });
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

    logger.info("[Security Audit] Ran a request as another user", {
        eventType: "auth.impersonation",
        impersonatorUid: caller.uid,
        targetUid: target.uid,
        targetRoles: target.roles,
        method: c.req.method,
        path: c.req.path,
        requestId: c.get("requestId")
    });
    return undefined;
}
