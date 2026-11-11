/**
 * Device sign-in: a terminal, or anything else without a browser of its own,
 * signs in through one. Modelled on RFC 8628, the OAuth 2.0 device
 * authorization grant, and answering with the session every other sign-in
 * door answers with.
 *
 * 1. The device asks `POST /auth/device` for a pending sign-in and gets a
 *    secret device code, a short user code and the page to approve it on.
 * 2. It shows the page and the code, and polls `POST /auth/device/token`.
 * 3. The person opens the page in a browser where they are signed in — or
 *    signs in there, with any method the app offers — sees the code the
 *    device showed, and approves (`POST /auth/device/approve`) or denies.
 * 4. The next poll is answered with a session for that account, once.
 *
 * ## What keeps it safe
 *
 * - **Approval is a signed-in act.** Describing, approving and denying take a
 *   live session, so a code is worth nothing to someone with no account, and
 *   the account approving is the account the device gets.
 * - **The second factor is inherited, never skipped.** The session minted for
 *   the device carries the approving session's assurance level. An account
 *   with a verified factor can only approve from an `aal2` session, so a
 *   device sign-in never yields a session the account's 2FA did not stand
 *   behind.
 * - **Short-lived and single-use.** A pending sign-in lives ten minutes, is
 *   decided once, and hands out its session once.
 * - **The person can see what they are approving.** The approval page shows
 *   the code, what the device calls itself, and where the request came from,
 *   because the attack on this grant is a stranger sending someone a link to
 *   approve the stranger's terminal.
 * - **Polling is paced.** A device that polls faster than its interval is
 *   answered `slow_down` and its interval grows, as RFC 8628 §3.5 has it.
 *
 * @module
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { randomBytes, randomInt } from "crypto";
import { z } from "zod";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";
import { ApiError } from "../api/errors";
import type { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";
import type { ResolvedAuthHooks } from "./auth-hooks";
import type { DeviceLoginRecord, DeviceLoginStore } from "./device-login-store";
import { requestClientAddress, type AuthLimiters } from "./rate-limiter";
import type { AuthModuleConfig, CreateSessionAndTokens } from "./routes";

/** How long a pending device sign-in lives: RFC 8628's example, and long enough to sign in from scratch. */
export const DEVICE_LOGIN_TTL_SECONDS = 10 * 60;
/** The interval a device is told to poll at, RFC 8628's default. */
export const DEVICE_LOGIN_INTERVAL_SECONDS = 5;
/** How much each `slow_down` adds to the interval (RFC 8628 §3.5). */
export const DEVICE_LOGIN_SLOW_DOWN_SECONDS = 5;
/**
 * The slack allowed between two polls before the second counts as early. The
 * gap is measured between the requests' arrivals, and a device that sleeps
 * exactly its interval can arrive a little sooner than that when the earlier
 * request was the slower one on the wire.
 */
const POLL_JITTER_SECONDS = 1;

/**
 * The user code's alphabet: consonants only, so no code spells a word, and
 * none of the letters a person confuses with a digit (RFC 8628 §6.1 suggests
 * exactly these twenty). Eight of them is 20⁸ ≈ 2.6 × 10¹⁰ codes.
 */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;

/** A user code as it is shown: `BCDF-GHJK`. */
export function formatUserCode(code: string): string {
    return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * A user code as typed or pasted — any case, with or without the dash or
 * spaces — in the form it is stored in, or null when it cannot be one.
 */
export function normalizeUserCode(input: string): string | null {
    const code = input.toUpperCase().replace(/[\s-]/g, "");
    if (code.length !== USER_CODE_LENGTH) return null;
    for (const char of code) if (!USER_CODE_ALPHABET.includes(char)) return null;
    return code;
}

export function generateUserCode(): string {
    let code = "";
    for (let i = 0; i < USER_CODE_LENGTH; i++) code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
    return code;
}

/** What a device calls itself, made safe to store and show: one line, printable, at most 100 characters. */
export function cleanClientName(input: string | undefined): string {
    // Control characters, including the ones that move a cursor or end a line,
    // would let a name rewrite the line it is shown on.
    // eslint-disable-next-line no-control-regex
    const name = (input ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
    return name.slice(0, 100) || "Unknown device";
}

/**
 * Polls per address per window. A device polling every five seconds for its
 * whole ten minutes makes 120; this leaves room for a few at once behind one
 * address (an office, a CI runner) without letting one address hammer it.
 */
export const DEVICE_POLL_LIMIT = { name: "auth:device-poll", windowMs: 15 * 60 * 1000, limit: 600 };

/** Where device sign-in keeps its state and sends people. */
export interface DeviceLoginRoutesConfig {
    store: DeviceLoginStore;
    /**
     * The page that approves a device sign-in, on the app the person signs in
     * to: `https://app.example.com/device`. It is handed the code as `?code=`
     * and calls `/auth/device/:code`, then `/auth/device/approve` or `/deny`.
     */
    verificationUrl: string;
}

export function mountDeviceLoginRoutes(deps: {
    router: Hono<HonoEnv>;
    config: AuthModuleConfig;
    deviceLogin: DeviceLoginRoutesConfig;
    limiters: AuthLimiters;
    ops: ResolvedAuthHooks;
    parseBody: <T>(schema: z.ZodSchema<T>, body: unknown) => T;
    requireLiveSession: MiddlewareHandler<HonoEnv>;
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
    const { router, config, deviceLogin, limiters, ops, parseBody, requireLiveSession, buildAuthResponse, createSessionAndTokens, applyTransformHook } = deps;
    const { authRepo } = config;
    const { store, verificationUrl } = deviceLogin;
    const pollLimiter = limiters.named(DEVICE_POLL_LIMIT);

    const startSchema = z.object({ clientName: z.string().max(500).optional() });
    const tokenSchema = z.object({ deviceCode: z.string().min(1).max(200) });
    const decideSchema = z.object({ userCode: z.string().min(1).max(50) });

    const userCodeOf = (input: string): string => {
        const code = normalizeUserCode(input);
        if (!code) throw ApiError.badRequest("That is not a sign-in code. It is eight letters, like BCDF-GHJK.", "INVALID_USER_CODE");
        return code;
    };

    /** The device sign-in a code names, for the approval page. */
    const describe = (record: DeviceLoginRecord) => ({
        userCode: formatUserCode(record.userCode),
        clientName: record.clientName,
        requestIp: record.requestIp,
        requestUserAgent: record.requestUserAgent,
        status: record.expired && record.status === "pending" ? "expired" : record.status,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString()
    });

    /** The pending sign-in a code names, or the refusal that says why it cannot be decided. */
    async function requirePending(code: string): Promise<DeviceLoginRecord> {
        const record = await store.findByUserCode(code);
        if (!record) {
            throw ApiError.notFound("No sign-in is waiting for that code. Check it against the one your device shows.", "DEVICE_LOGIN_NOT_FOUND");
        }
        if (record.status !== "pending") {
            throw ApiError.conflict(`This sign-in has already been ${record.status === "denied" ? "denied" : "approved"}.`, "DEVICE_LOGIN_DECIDED");
        }
        if (record.expired) {
            throw new ApiError(410, "DEVICE_LOGIN_EXPIRED", "This sign-in has expired. Start it again on your device.", undefined, true);
        }
        return record;
    }

    function signedInCaller(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): { uid: string; aal: "aal1" | "aal2" } {
        const user = c.get("user") as { uid?: string; aal?: "aal1" | "aal2"; isAnonymous?: boolean } | undefined;
        if (!user?.uid) throw ApiError.unauthorized("Not authenticated");
        // A guest has no account to lend a device: nobody could sign in as it
        // again, and a device holding it would hold an account nobody owns.
        if (user.isAnonymous === true) {
            throw ApiError.forbidden("Sign in with an account to approve a device.", "ANONYMOUS_NOT_ALLOWED");
        }
        return { uid: user.uid, aal: user.aal === "aal2" ? "aal2" : "aal1" };
    }

    /**
     * POST /auth/device — start a device sign-in.
     */
    router.post("/device", limiters.strict, async (c) => {
        const { clientName } = parseBody(startSchema, await c.req.json().catch(() => ({})));
        const deviceCode = randomBytes(32).toString("base64url");
        const login = {
            clientName: cleanClientName(clientName),
            requestIp: requestClientAddress(c),
            requestUserAgent: (c.req.header("user-agent") || "unknown").slice(0, 300),
            expiresAt: new Date(Date.now() + DEVICE_LOGIN_TTL_SECONDS * 1000),
            intervalSeconds: DEVICE_LOGIN_INTERVAL_SECONDS
        };
        // A collision among live codes is a one-in-billions event; a second
        // draw settles it.
        for (let attempt = 0; attempt < 5; attempt++) {
            const userCode = generateUserCode();
            if (!(await store.create(deviceCode, { ...login, userCode }))) continue;
            const shown = formatUserCode(userCode);
            const complete = new URL(verificationUrl);
            complete.searchParams.set("code", shown);
            return c.json({
                deviceCode,
                userCode: shown,
                verificationUri: verificationUrl,
                verificationUriComplete: complete.toString(),
                expiresIn: DEVICE_LOGIN_TTL_SECONDS,
                interval: DEVICE_LOGIN_INTERVAL_SECONDS
            });
        }
        throw ApiError.internal("Could not start a device sign-in. Try again.");
    });

    /**
     * POST /auth/device/token — poll. `400` with RFC 8628's error codes until
     * the sign-in is decided; then the session, once.
     *
     * Always answered in the body, whatever `cookieAuth` says: the caller is a
     * device without a browser, and a cookie is a credential it cannot keep.
     */
    router.post("/device/token", pollLimiter, async (c) => {
        const { deviceCode } = parseBody(tokenSchema, await c.req.json());
        const refuse = (code: string, message: string, details?: unknown) =>
            new ApiError(400, code, message, details, true);

        const poll = await store.poll(deviceCode);
        if (!poll) throw refuse("invalid_grant", "No device sign-in has that device code.");
        if (poll.status === "consumed") throw refuse("invalid_grant", "This device sign-in has already been used.");
        if (poll.expired) throw refuse("expired_token", "The device sign-in expired before it was approved.");

        if (poll.secondsSincePreviousPoll !== null && poll.secondsSincePreviousPoll < poll.intervalSeconds - POLL_JITTER_SECONDS) {
            await store.slowDown(deviceCode, DEVICE_LOGIN_SLOW_DOWN_SECONDS);
            const interval = poll.intervalSeconds + DEVICE_LOGIN_SLOW_DOWN_SECONDS;
            throw refuse("slow_down", `Polling too fast. Wait ${interval} seconds between polls.`, { interval });
        }
        if (poll.status === "pending") {
            throw refuse("authorization_pending", "Waiting for the sign-in to be approved in the browser.", { interval: poll.intervalSeconds });
        }
        if (poll.status === "denied") throw refuse("access_denied", "The sign-in was denied in the browser.");

        const approved = await store.consume(deviceCode);
        if (!approved) throw refuse("invalid_grant", "This device sign-in has already been used.");

        const user = await authRepo.getUserById(approved.uid);
        if (!user) throw refuse("invalid_grant", "The account that approved this sign-in no longer exists.");

        // The approving session met the second-factor gate — `/approve`
        // refuses an `aal1` session for an account with a factor — so this
        // session is minted at that session's level rather than asked again.
        const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
            user.id,
            c.req.header("user-agent") || "unknown",
            requestClientAddress(c),
            { method: "device", skipMfaGate: true, aal: approved.aal }
        );

        logger.info("[Security Audit] Device sign-in completed", { eventType: "auth.device.signed_in", uid: user.id });
        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "device").catch(err => {
                logger.error("[AuthHooks] onAuthenticated error", { error: err instanceof Error ? err.message : err });
            });
        }

        const response = buildAuthResponse(user, roleIds, accessToken, refreshToken, "device") as AuthResponsePayload;
        return c.json(await applyTransformHook(response, "device", c.req.raw, user.id));
    });

    /**
     * GET /auth/device/:userCode — what is asking to sign in, for the page
     * that approves it. Signed-in only: where a request came from is not for
     * anyone holding a guessed code.
     */
    router.get("/device/:userCode", limiters.strict, requireLiveSession, async (c) => {
        signedInCaller(c);
        const record = await store.findByUserCode(userCodeOf(c.req.param("userCode")));
        if (!record) {
            throw ApiError.notFound("No sign-in is waiting for that code. Check it against the one your device shows.", "DEVICE_LOGIN_NOT_FOUND");
        }
        return c.json(describe(record));
    });

    /** POST /auth/device/approve — give the device a session for this account. */
    router.post("/device/approve", limiters.strict, requireLiveSession, async (c) => {
        const caller = signedInCaller(c);
        const code = userCodeOf(parseBody(decideSchema, await c.req.json()).userCode);
        await requirePending(code);

        if (caller.aal !== "aal2" && typeof authRepo.hasVerifiedMfaFactors === "function"
            && await authRepo.hasVerifiedMfaFactors(caller.uid)) {
            throw ApiError.forbidden(
                "This account has two-factor authentication on. Sign in again with your second factor, then approve the device.",
                "AAL2_REQUIRED"
            );
        }

        if (!(await store.decide(code, { approve: true, uid: caller.uid, aal: caller.aal }))) {
            // Decided or expired between the check and the write.
            await requirePending(code);
            throw ApiError.conflict("This sign-in has already been decided.", "DEVICE_LOGIN_DECIDED");
        }
        logger.info("[Security Audit] Device sign-in approved", { eventType: "auth.device.approved", uid: caller.uid });
        return c.json({ success: true });
    });

    /** POST /auth/device/deny — refuse it; the device is told on its next poll. */
    router.post("/device/deny", limiters.strict, requireLiveSession, async (c) => {
        const caller = signedInCaller(c);
        const code = userCodeOf(parseBody(decideSchema, await c.req.json()).userCode);
        await requirePending(code);
        if (!(await store.decide(code, { approve: false, uid: caller.uid }))) {
            await requirePending(code);
            throw ApiError.conflict("This sign-in has already been decided.", "DEVICE_LOGIN_DECIDED");
        }
        logger.info("[Security Audit] Device sign-in denied", { eventType: "auth.device.denied", uid: caller.uid });
        return c.json({ success: true });
    });
}
