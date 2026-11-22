/**
 * `POST /auth/platform-signin`: the platform hosting this backend signs a
 * project's owner in to the project's admin panel.
 *
 * ## Why this exists
 *
 * A Rebase Cloud project runs under `NODE_ENV=production`, where the first
 * account to register is not promoted (`registration-policy.ts`), so a fresh
 * project's admin panel is a login form nobody holds credentials for. The way
 * in was `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` set before the first
 * deploy, which nobody knew to do — and the person who owns the project is
 * already signed in, to the platform's console.
 *
 * So the console signs a platform token (`platform-token.ts`) carrying
 * {@link PLATFORM_SIGNIN_SCOPES}, for that person, for this project, for a
 * minute or two, and hands it to the admin panel in the URL fragment. This
 * route trades it for an ordinary session.
 *
 * ## Who it signs in, and as what
 *
 * The control plane mints the scope only for an owner or admin of the
 * organization that owns the project (`saas` `functions/admin-signin.ts`):
 * people who can already set this project's environment and redeploy it, which
 * reaches everything an `admin` of the app can. So the session it opens is the
 * `admin` role, on the account whose email the token names — found, or created
 * with no password and the address marked verified, because the platform has
 * verified it.
 *
 * An existing account under that email whose address nobody had proven may
 * have been registered by somebody else, with a password they know. Before
 * that account becomes the owner's admin, `confirmAddressOwnership` removes
 * every way in it did not vouch for and ends its sessions, as clicking a magic
 * link does.
 *
 * ## What it refuses
 *
 * Everything `verifyPlatformToken` refuses (signature, issuer, another
 * project's audience, a token from the future or living past
 * {@link PLATFORM_TOKEN_MAX_LIFETIME_SECONDS}), and on top of that: a token
 * without this scope, without a `jti` or an email, or living longer than
 * {@link PLATFORM_SIGNIN_MAX_LIFETIME_SECONDS}; and the same token twice. A
 * spent `jti` is remembered in the backend's rate-limit store — shared across
 * replicas when the backend has a shared one — until the token would have
 * expired anyway.
 *
 * The second-factor gate in `createSessionAndTokens` applies as on every other
 * door: an account with a verified factor gets `MFA_REQUIRED`, not a session.
 *
 * ## Taking it back
 *
 * When `admin` was not already the account's, the door records that the
 * platform granted it (`platform-grants.ts`). `POST /auth/platform-revoke`,
 * mounted beside it, takes a token of its own scope
 * ({@link PLATFORM_REVOKE_SCOPES}, held as tightly) when the platform removes
 * the person's access, removes the recorded roles, and ends the account's
 * sessions. A token carrying both scopes opens neither door.
 *
 * @module
 */
import { Hono } from "hono";
import { z } from "zod";
import { normalizeEmail } from "@rebasepro/common";
import { ADMIN_ROLE } from "@rebasepro/types";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError } from "../api/errors";
import { logger } from "../utils/logger";
import type { AuthModuleConfig, CreateSessionAndTokens } from "./routes";
import type { ResolvedAuthHooks } from "./auth-hooks";
import type { CreateUserData } from "./interfaces";
import type { RateLimitStore } from "./rate-limit-store";
import { requestClientAddress, type AuthLimiters } from "./rate-limiter";
import { redactRefreshToken } from "./cookie-utils";
import { confirmAddressOwnership } from "./address-ownership";
import { isDeliverableAddress } from "./deliverable-address";
import { revokeAllSessions } from "./token-revocation";
import { heldPlatformRoles, platformGrantedRoles, writePlatformGrantedRoles } from "./platform-grants";
import {
    PLATFORM_REVOKE_SCOPES,
    PLATFORM_SIGNIN_MAX_LIFETIME_SECONDS,
    PLATFORM_SIGNIN_SCOPES,
    PLATFORM_TOKEN_MAX_LIFETIME_SECONDS,
    verifyPlatformToken,
    type PlatformCaller,
    type PlatformTokenConfig
} from "./platform-token";

/** What a backend hands the auth routes to turn the sign-in door on. */
export interface PlatformSignInConfig {
    /** The platform's public keys and this project's audience. */
    tokens: PlatformTokenConfig;
    /** Where a spent token's `jti` is remembered. */
    usedTokens: RateLimitStore;
}

const platformSignInSchema = z.object({ token: z.string().min(1).max(8192) });

/** The refusal every bad token gets, with the reason in the server's log rather than the response. */
const invalid = () => ApiError.unauthorized(
    "This sign-in link is invalid or has expired. Open the admin again from the project's page in the console.",
    "INVALID_PLATFORM_TOKEN"
);

/** The two doors a person-bearing platform token opens, and the scope of each. */
const DOOR_SCOPES = {
    signin: PLATFORM_SIGNIN_SCOPES,
    revoke: PLATFORM_REVOKE_SCOPES
} as const;

type PlatformDoor = keyof typeof DOOR_SCOPES;

/**
 * Verify a token presented at one of the doors: everything
 * `verifyPlatformToken` checks, this door's scope and not the other's, a `jti`
 * and a deliverable email, at most {@link PLATFORM_SIGNIN_MAX_LIFETIME_SECONDS},
 * and spent by this, its first use. The reason for a refusal goes to the log.
 */
async function acceptPlatformDoorToken(
    token: string,
    platformSignIn: PlatformSignInConfig,
    door: PlatformDoor
): Promise<{ verified: PlatformCaller & { tokenId: string }; email: string } | { refused: true }> {
    const logRefusal = (reason: string, verified?: PlatformCaller) => {
        logger.warn(door === "signin" ? "[Auth] Platform sign-in refused" : "[Auth] Platform revocation refused", {
            reason,
            ...(verified ? { subject: verified.subject, jti: verified.tokenId } : {})
        });
        return { refused: true as const };
    };

    // Verified against both doors' scopes, so a token that also carries the
    // other door's is seen, and refused, rather than filtered down to this one.
    const verified = await verifyPlatformToken(token, platformSignIn.tokens, undefined, [...PLATFORM_SIGNIN_SCOPES, ...PLATFORM_REVOKE_SCOPES]);
    if ("refusal" in verified) return logRefusal(verified.refusal);
    const own = DOOR_SCOPES[door];
    if (!verified.scopes.some(scope => own.includes(scope))) {
        return logRefusal(`the token carries no ${own.join(", ")} scope`, verified);
    }
    if (!verified.scopes.every(scope => own.includes(scope))) {
        return logRefusal("the token carries the scopes of both the sign-in and the revocation door", verified);
    }

    const lifetime = verified.expiresAt - verified.issuedAt;
    const email = verified.email ? normalizeEmail(verified.email) : undefined;
    const tokenId = verified.tokenId;
    const refusal = !tokenId
        ? "the token carries no jti, so it could be used twice"
        : !email || !isDeliverableAddress(email)
            ? "the token names no usable email"
            : lifetime > PLATFORM_SIGNIN_MAX_LIFETIME_SECONDS
                ? `a ${door} token may live at most ${PLATFORM_SIGNIN_MAX_LIFETIME_SECONDS} seconds`
                : undefined;
    if (refusal || !email || !tokenId) return logRefusal(refusal ?? "the token is incomplete", verified);

    // Spent by its first use. The window outlasts any token this door
    // accepts, whatever the clock skew, so a replay always finds the mark.
    const spent = await platformSignIn.usedTokens.hit(
        `platform-${door}:${tokenId}`,
        (PLATFORM_TOKEN_MAX_LIFETIME_SECONDS + 120) * 1000,
        1
    );
    if (!spent.allowed) return logRefusal("token already used", verified);

    return { verified: { ...verified, tokenId }, email };
}

export function mountPlatformSignInRoutes(deps: {
    router: Hono<HonoEnv>;
    config: AuthModuleConfig;
    platformSignIn: PlatformSignInConfig;
    limiters: AuthLimiters;
    ops: ResolvedAuthHooks;
    parseBody: <T>(schema: z.ZodSchema<T>, body: unknown) => T;
    buildAuthResponse: (
        user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; emailVerified?: boolean; isAnonymous?: boolean; metadata?: Record<string, unknown> | null },
        roleIds: string[],
        accessToken: string,
        refreshToken: string,
        providerId: string
    ) => unknown;
    createSessionAndTokens: CreateSessionAndTokens;
    applyTransformHook: (
        response: AuthResponsePayload,
        method: TransformAuthResponseContext["method"],
        request: Request,
        uid: string
    ) => Promise<AuthResponsePayload>;
}): void {
    const { router, config, platformSignIn, limiters, ops, parseBody, buildAuthResponse, createSessionAndTokens, applyTransformHook } = deps;
    const authRepo = config.authRepo;

    router.post("/platform-signin", limiters.strict, async (c) => {
        const { token } = parseBody(platformSignInSchema, await c.req.json().catch(() => undefined));
        const door = await acceptPlatformDoorToken(token, platformSignIn, "signin");
        if ("refused" in door) throw invalid();
        const { verified, email } = door;

        let user = await authRepo.getUserByEmail(email);
        const created = !user;
        if (!user) {
            let createData: CreateUserData = { email, emailVerified: true };
            if (ops.beforeUserCreate) createData = await ops.beforeUserCreate(createData);
            user = await authRepo.createUser(createData);
        } else if (!user.emailVerified) {
            // See the module comment: whatever way in somebody else left on an
            // unproven account goes before it becomes the owner's admin.
            await confirmAddressOwnership(authRepo, user, null);
            user = { ...user, emailVerified: true, passwordHash: null };
        }

        const roleIds = await authRepo.getUserRoleIds(user.id);
        if (!roleIds.includes(ADMIN_ROLE)) {
            // Recorded only when this door adds the role: an `admin` the
            // account already held was granted by hand and is not the
            // platform's to take back (`platform-grants.ts`). Written first,
            // so a failure between the two writes leaves a record of a role
            // not held — which revokes nothing — never an unrecorded grant.
            await writePlatformGrantedRoles(authRepo, user, [...platformGrantedRoles(user), ADMIN_ROLE]);
            await authRepo.setUserRoles(user.id, [...roleIds, ADMIN_ROLE]);
        }

        const session = await createSessionAndTokens(
            user.id,
            c.req.header("user-agent") || "unknown",
            requestClientAddress(c),
            { method: "platform" }
        );

        // Who came in through the platform, on whose word: the line an owner
        // looks for, matched to the console's mint by `jti`.
        logger.info("[Auth] Platform sign-in", {
            subject: verified.subject,
            jti: verified.tokenId,
            uid: user.id,
            created,
            promoted: !roleIds.includes(ADMIN_ROLE)
        });

        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "platform").catch(err => {
                logger.error("[AuthHooks] onAuthenticated error", { error: err instanceof Error ? err.message : err });
            });
        }

        const authResponse = buildAuthResponse(user, session.roleIds, session.accessToken, session.refreshToken, "platform") as AuthResponsePayload;
        const transformed = await applyTransformHook(authResponse, "platform", c.req.raw, user.id);
        c.header("Cache-Control", "no-store");
        return c.json(redactRefreshToken(transformed, c, session.refreshToken, config.cookieAuth));
    });

    /**
     * `POST /auth/platform-revoke`: the platform withdrew the person's access
     * to this project. Takes back the roles the sign-in door granted their
     * account (`platform-grants.ts`) and ends every session it holds; a role
     * granted by hand in the app stays, and the account is never deleted.
     * `{ revoked: false }` when there was nothing the platform had granted —
     * no such account, or only hand-granted roles.
     */
    router.post("/platform-revoke", limiters.strict, async (c) => {
        const { token } = parseBody(platformSignInSchema, await c.req.json().catch(() => undefined));
        const door = await acceptPlatformDoorToken(token, platformSignIn, "revoke");
        if ("refused" in door) throw invalid();
        const { verified, email } = door;
        c.header("Cache-Control", "no-store");

        const user = await authRepo.getUserByEmail(email);
        if (!user) {
            logger.info("[Auth] Platform revocation", { subject: verified.subject, jti: verified.tokenId, revoked: false, reason: "no account" });
            return c.json({ revoked: false });
        }

        const roleIds = await authRepo.getUserRoleIds(user.id);
        const taken = heldPlatformRoles(user, roleIds);
        if (taken.length > 0) {
            await authRepo.setUserRoles(user.id, roleIds.filter(role => !taken.includes(role)));
            await revokeAllSessions(authRepo, user.id);
        }
        // The record goes last, and whole — including a role an administrator
        // already removed by hand — so a failure above leaves it in place for
        // the platform's retry.
        if (platformGrantedRoles(user).length > 0) {
            await writePlatformGrantedRoles(authRepo, user, []);
        }

        logger.info("[Auth] Platform revocation", {
            subject: verified.subject,
            jti: verified.tokenId,
            uid: user.id,
            revoked: taken.length > 0,
            roles: taken
        });
        return c.json({ revoked: taken.length > 0 });
    });
}
