import { requireAuth, optionalAuth, extractUserFromToken, requireAdmin, queryTokenAuth } from "../src/auth/middleware";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

// ── Minimal Hono-context mock ────────────────────────────────────────────
function createMockContext(opts: {
    authHeader?: string;
    queryToken?: string;
    user?: any;
} = {}) {
    let capturedStatus: number | undefined;
    let capturedBody: any;
    const variables = new Map<string, any>();

    if (opts.user !== undefined) variables.set("user", opts.user);

    const c = {
        req: {
            header: (name: string) => {
                if (name === "authorization") return opts.authHeader;
                return undefined;
            },
            query: (name: string) => {
                if (name === "token") return opts.queryToken;
                return undefined;
            }
        },
        json: (body: any, status?: number) => {
            capturedBody = body;
            capturedStatus = status ?? 200;
            return new Response(JSON.stringify(body), { status: capturedStatus });
        },
        set: (key: string, value: any) => variables.set(key, value),
        get: (key: string) => variables.get(key)
    } as any;

    return {
        c,
        getStatus: () => capturedStatus,
        getBody: () => capturedBody,
        getUser: () => variables.get("user")
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
            const token = generateAccessToken("user-123", ["admin", "editor"]);
            const { c, getUser } = createMockContext({ authHeader: `Bearer ${token}` });

            await requireAuth(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({
                uid: "user-123",
                roles: ["admin", "editor"],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number)
            });
        });

        it("should return 401 for missing Authorization header", async () => {
            const { c, getStatus, getBody } = createMockContext();

            await requireAuth(c, nextFn);

            expect(getStatus()).toBe(401);
            expect(getBody()).toEqual({
                error: {
                    message: "Authorization header missing or invalid",
                    code: "UNAUTHORIZED"
                }
            });
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 401 for Authorization header without Bearer prefix", async () => {
            const { c, getStatus } = createMockContext({ authHeader: "token-without-bearer" });

            await requireAuth(c, nextFn);

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 401 for invalid token", async () => {
            const { c, getStatus, getBody } = createMockContext({ authHeader: "Bearer invalid-token" });

            await requireAuth(c, nextFn);

            expect(getStatus()).toBe(401);
            expect(getBody()).toEqual({
                error: {
                    message: "Invalid or expired token",
                    code: "UNAUTHORIZED"
                }
            });
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 401 for token signed with different secret", async () => {
            const token = generateAccessToken("user-123", ["admin"]);
            configureJwt({ secret: "different-secret-that-is-at-least-32-chars-long" });
            const { c, getStatus } = createMockContext({ authHeader: `Bearer ${token}` });

            await requireAuth(c, nextFn);

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
            const token = generateAccessToken("user-123", ["admin"]);
            const { c, getStatus, getUser } = createMockContext({ authHeader: `bearer ${token}` });

            await requireAuth(c, nextFn);

            expect(getStatus()).toBeUndefined();
            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({ uid: "user-123",
roles: ["admin"],
aal: "aal1",
iat: expect.any(Number) });
        });

        it("should handle an uppercase BEARER prefix", async () => {
            const token = generateAccessToken("user-123", ["admin"]);
            const { c, getUser } = createMockContext({ authHeader: `BEARER ${token}` });

            await requireAuth(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({ uid: "user-123",
roles: ["admin"],
aal: "aal1",
iat: expect.any(Number) });
        });

        it("should still reject a non-Bearer scheme", async () => {
            // Folding the scheme's case must not turn into accepting any scheme:
            // a Basic credential is not a token, and must not be verified as one.
            const { c, getStatus } = createMockContext({ authHeader: "Basic dXNlcjpwYXNz" });

            await requireAuth(c, nextFn);

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should not treat a scheme merely starting with 'bearer' as Bearer", async () => {
            const token = generateAccessToken("user-123", ["admin"]);
            const { c, getStatus } = createMockContext({ authHeader: `Bearerish ${token}` });

            await requireAuth(c, nextFn);

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should NOT accept token from query parameter by default", async () => {
            const token = generateAccessToken("user-123", ["viewer"]);
            const { c, getStatus } = createMockContext({ queryToken: token });

            await requireAuth(c, nextFn);

            expect(getStatus()).toBe(401);
            expect(nextFn).not.toHaveBeenCalled();
        });
    });

    describe("queryTokenAuth", () => {
        it("should accept token from query parameter", async () => {
            const token = generateAccessToken("user-123", ["viewer"]);
            const { c, getUser } = createMockContext({ queryToken: token });

            await queryTokenAuth(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({
                uid: "user-123",
                roles: ["viewer"],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number)
            });
        });

        it("should return 401 for missing query token when followed by requireAuth", async () => {
            const { c, getStatus, getBody } = createMockContext();

            await queryTokenAuth(c, async () => {
                await requireAuth(c, nextFn);
            });

            expect(getStatus()).toBe(401);
            expect(getBody()).toEqual({
                error: {
                    message: "Authorization header missing or invalid",
                    code: "UNAUTHORIZED"
                }
            });
        });
    });

    describe("optionalAuth", () => {
        it("should set user for valid token", async () => {
            const token = generateAccessToken("user-456", ["viewer"]);
            const { c, getUser } = createMockContext({ authHeader: `Bearer ${token}` });

            await optionalAuth(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toEqual({
                uid: "user-456",
                roles: ["viewer"],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number)
            });
        });

        it("should call next() without setting user when no token provided", async () => {
            const { c, getUser } = createMockContext();

            await optionalAuth(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toBeUndefined();
        });

        it("should call next() without setting user for invalid token", async () => {
            const { c, getUser } = createMockContext({ authHeader: "Bearer invalid-token" });

            await optionalAuth(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toBeUndefined();
        });

        it("should call next() without setting user for non-Bearer auth", async () => {
            const { c, getUser } = createMockContext({ authHeader: "Basic dXNlcjpwYXNz" });

            await optionalAuth(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
            expect(getUser()).toBeUndefined();
        });
    });

    describe("requireAdmin", () => {
        it("should return 401 if user is not authenticated", async () => {
            const { c, getStatus, getBody } = createMockContext();

            await requireAdmin(c, nextFn);

            expect(getStatus()).toBe(401);
            expect(getBody()).toEqual({
                error: {
                    message: "User not authenticated. requireAuth middleware is missing?",
                    code: "UNAUTHORIZED"
                }
            });
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 403 if user has no roles array", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123" } });

            await requireAdmin(c, nextFn);

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 403 if user has empty roles array", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: [] } });

            await requireAdmin(c, nextFn);

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should return 403 if user has standard roles (forbidden)", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: ["editor", "viewer"] } });

            await requireAdmin(c, nextFn);

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });

        it("should allow access if user has 'admin' role", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: ["editor", "admin"] } });

            await requireAdmin(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
            expect(getStatus()).toBeUndefined(); // No error response
        });

        it("should allow access if user has 'schema-admin' role", async () => {
            const { c } = createMockContext({ user: { uid: "user-123",
roles: ["schema-admin"] } });

            await requireAdmin(c, nextFn);

            expect(nextFn).toHaveBeenCalled();
        });

        it("should block access for malformed spoofed string roles", async () => {
            const { c, getStatus } = createMockContext({ user: { uid: "user-123",
roles: ["schema-adminstration", "admins", "admin "] } });

            await requireAdmin(c, nextFn);

            expect(getStatus()).toBe(403);
            expect(nextFn).not.toHaveBeenCalled();
        });
    });

    describe("extractUserFromToken", () => {
        it("should extract user from valid token", () => {
            const token = generateAccessToken("ws-user-123", ["admin"]);
            const payload = extractUserFromToken(token);

            expect(payload).toEqual({
                uid: "ws-user-123",
                roles: ["admin"],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number)
            });
        });

        it("should return null for invalid token", () => {
            const payload = extractUserFromToken("invalid-token");
            expect(payload).toBeNull();
        });

        it("should return null for empty token", () => {
            const payload = extractUserFromToken("");
            expect(payload).toBeNull();
        });

        it("should work with tokens having empty roles", () => {
            const token = generateAccessToken("user-no-roles", []);
            const payload = extractUserFromToken(token);

            expect(payload).toEqual({
                uid: "user-no-roles",
                roles: [],
                aal: "aal1",
                // `iat` is carried through verification now: revocation compares the
                // token\'s issue time against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number)
            });
        });
    });
});
