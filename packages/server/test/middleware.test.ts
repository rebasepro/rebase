import { Context } from "hono";
import { requireAuth, optionalAuth, extractUserFromToken, requireAdmin, queryTokenAuth } from "../src/auth/middleware";
import type { HonoEnv } from "../src/api/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

// ── A real Hono context, and the answer the middleware returned ─────────
/** The last response a middleware under test answered with. */
let answer: Response | undefined;

/** Keep what a middleware returned: a refusal is a response, letting through is not. */
function record(result: Response | void): void {
    if (result) answer = result;
}

function createMockContext(opts: {
    authHeader?: string;
    queryToken?: string;
    user?: HonoEnv["Variables"]["user"];
} = {}) {
    const url = new URL("http://localhost/");
    if (opts.queryToken !== undefined) url.searchParams.set("token", opts.queryToken);
    const headers = new Headers();
    if (opts.authHeader !== undefined) headers.set("authorization", opts.authHeader);

    const c = new Context<HonoEnv>(new Request(url, { headers }));
    if (opts.user !== undefined) c.set("user", opts.user);
    answer = undefined;

    return {
        c,
        getStatus: (): number | undefined => answer?.status,
        getBody: async (): Promise<unknown> => (answer ? await answer.clone().json() : undefined),
        getUser: () => c.get("user")
    };
}

describe("Auth Middleware", () => {
    const testSecret = "test-secret-key-for-middleware-testing";
    const nextFn = jest.fn();

    beforeAll(() => {
        configureJwt({
            secret: testSecret,
            accessExpiresIn: "1h",
            refreshExpiresIn: "30d"
        });
    });

    beforeEach(() => {
        nextFn.mockClear();
    });

    describe("requireAuth", () => {
        it("should call next() and set user for valid token", async () => {
            const token = await generateAccessToken("user-123", ["admin", "editor"]);
            const { c, getUser } = createMockContext({ authHeader: `Bearer ${token}` });

            record(await requireAuth(c, nextFn));

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({
                uid: "user-123",
                roles: ["admin", "editor"],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number),
                exp: expect.any(Number)
            });
        });

        it("should return 401 for missing Authorization header", async () => {
            const { c, getStatus, getBody } = createMockContext();

            record(await requireAuth(c, nextFn));

            expect(getStatus()).toBe(401);
            expect(await getBody()).toEqual({
                error: {
                    message: "Authorization header missing or invalid",
                    code: "UNAUTHORIZED"
                }
            });
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 401 for Authorization header without Bearer prefix", async () => {
            const { c, getStatus } = createMockContext({ authHeader: "token-without-bearer" });

            record(await requireAuth(c, nextFn));

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 401 for invalid token", async () => {
            const { c, getStatus, getBody } = createMockContext({ authHeader: "Bearer invalid-token" });

            record(await requireAuth(c, nextFn));

            expect(getStatus()).toBe(401);
            expect(await getBody()).toEqual({
                error: {
                    message: "Invalid or expired token",
                    code: "UNAUTHORIZED"
                }
            });
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 401 for token signed with different secret", async () => {
            const token = await generateAccessToken("user-123", ["admin"]);
            configureJwt({ secret: "different-secret-that-is-at-least-32-chars-long" });
            const { c, getStatus } = createMockContext({ authHeader: `Bearer ${token}` });

            record(await requireAuth(c, nextFn));

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();

            // Reset to original secret
            configureJwt({ secret: testSecret });
        });

        it("should handle lowercase bearer prefix", async () => {
            // RFC 7235 §2.1: the auth-scheme is case-insensitive. This test used
            // to pin the opposite — a 401 for `bearer` — which turned a spec
            // deviation into a documented guarantee. Behaviour change: `bearer`,
            // `BEARER` and any other casing are now accepted, and the token is
            // taken verbatim after the first space.
            const token = await generateAccessToken("user-123", ["admin"]);
            const { c, getStatus, getUser } = createMockContext({ authHeader: `bearer ${token}` });

            record(await requireAuth(c, nextFn));

            expect(getStatus()).toBeUndefined();
            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({ uid: "user-123",
roles: ["admin"],
aal: "aal1",
iat: expect.any(Number),
                exp: expect.any(Number) });
        });

        it("should handle an uppercase BEARER prefix", async () => {
            const token = await generateAccessToken("user-123", ["admin"]);
            const { c, getUser } = createMockContext({ authHeader: `BEARER ${token}` });

            record(await requireAuth(c, nextFn));

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({ uid: "user-123",
roles: ["admin"],
aal: "aal1",
iat: expect.any(Number),
                exp: expect.any(Number) });
        });

        it("should still reject a non-Bearer scheme", async () => {
            // Folding the scheme's case must not turn into accepting any scheme:
            // a Basic credential is not a token, and must not be verified as one.
            const { c, getStatus } = createMockContext({ authHeader: "Basic dXNlcjpwYXNz" });

            record(await requireAuth(c, nextFn));

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should not treat a scheme merely starting with 'bearer' as Bearer", async () => {
            const token = await generateAccessToken("user-123", ["admin"]);
            const { c, getStatus } = createMockContext({ authHeader: `Bearerish ${token}` });

            record(await requireAuth(c, nextFn));

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should NOT accept token from query parameter by default", async () => {
            const token = await generateAccessToken("user-123", ["viewer"]);
            const { c, getStatus } = createMockContext({ queryToken: token });

            record(await requireAuth(c, nextFn));

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();
        });
    });

    describe("queryTokenAuth", () => {
        it("should accept token from query parameter", async () => {
            const token = await generateAccessToken("user-123", ["viewer"]);
            const { c, getUser } = createMockContext({ queryToken: token });

            record(await queryTokenAuth(c, nextFn));

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({
                uid: "user-123",
                roles: ["viewer"],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number),
                exp: expect.any(Number)
            });
        });

        it("should return 401 for missing query token when followed by requireAuth", async () => {
            const { c, getStatus, getBody } = createMockContext();

            record(await queryTokenAuth(c, async () => {
                record(await requireAuth(c, nextFn));
            }));

            expect(getStatus()).toBe(401);
            expect(await getBody()).toEqual({
                error: {
                    message: "Authorization header missing or invalid",
                    code: "UNAUTHORIZED"
                }
            });
        });
    });

    describe("optionalAuth", () => {
        it("should set user for valid token", async () => {
            const token = await generateAccessToken("user-456", ["viewer"]);
            const { c, getUser } = createMockContext({ authHeader: `Bearer ${token}` });

            record(await optionalAuth(c, nextFn));

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({
                uid: "user-456",
                roles: ["viewer"],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number),
                exp: expect.any(Number)
            });
        });

        it("should call next() without setting user when no token provided", async () => {
            const { c, getUser } = createMockContext();

            record(await optionalAuth(c, nextFn));

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toBeUndefined();
        });

        it("should call next() without setting user for invalid token", async () => {
            const { c, getUser } = createMockContext({ authHeader: "Bearer invalid-token" });

            record(await optionalAuth(c, nextFn));

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toBeUndefined();
        });

        it("should call next() without setting user for non-Bearer auth", async () => {
            const { c, getUser } = createMockContext({ authHeader: "Basic dXNlcjpwYXNz" });

            record(await optionalAuth(c, nextFn));

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toBeUndefined();
        });
    });

    describe("requireAdmin", () => {
        it("should return 401 if user is not authenticated", async () => {
            const { c, getStatus, getBody } = createMockContext();

            record(await requireAdmin(c, nextFn));

            expect(getStatus()).toBe(401);
            expect(await getBody()).toEqual({
                error: {
                    message: "User not authenticated. requireAuth middleware is missing?",
                    code: "UNAUTHORIZED"
                }
            });
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 403 if user has no roles array", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123" } });

            record(await requireAdmin(c, nextFn));

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 403 if user has empty roles array", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: [] } });

            record(await requireAdmin(c, nextFn));

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 403 if user has standard roles (forbidden)", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: ["editor", "viewer"] } });

            record(await requireAdmin(c, nextFn));

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should allow access if user has 'admin' role", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: ["editor", "admin"] } });

            record(await requireAdmin(c, nextFn));

            expect(nextFn).toHaveBeenCalled();
            expect(getStatus()).toBeUndefined(); // No error response
        });

        it("should block a role that only sounds administrative", async () => {
            // `admin` is the one role holding every scope; a role declared with
            // a narrower set is not an administrator.
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: ["schema-admin"] } });

            record(await requireAdmin(c, nextFn));

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should block access for malformed spoofed string roles", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: ["schema-adminstration", "admins", "admin "] } });

            record(await requireAdmin(c, nextFn));

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });
    });

    describe("extractUserFromToken", () => {
        it("should extract user from valid token", async () => {
            const token = await generateAccessToken("ws-user-123", ["admin"]);
            const payload = await extractUserFromToken(token);

            expect(payload).toEqual({
                uid: "ws-user-123",
                roles: ["admin"],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number),
                exp: expect.any(Number)
            });
        });

        it("should return null for invalid token", async () => {
            const payload = await extractUserFromToken("invalid-token");
            expect(payload).toBeNull();
        });

        it("should return null for empty token", async () => {
            const payload = await extractUserFromToken("");
            expect(payload).toBeNull();
        });

        it("should work with tokens having empty roles", async () => {
            const token = await generateAccessToken("user-no-roles", []);
            const payload = await extractUserFromToken(token);

            expect(payload).toEqual({
                uid: "user-no-roles",
                roles: [],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number),
                exp: expect.any(Number)
            });
        });
    });
});
