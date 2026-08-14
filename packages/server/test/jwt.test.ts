import {
    configureJwt,
    generateAccessToken,
    verifyAccessToken,
    generateRefreshToken,
    hashRefreshToken,
    getRefreshTokenExpiry,
    getRefreshTokenTtlMs,
    MAX_COOKIE_AGE_MS,
    getAccessTokenExpiryMs,
    getAccessTokenExpiry,
    generateDownloadToken,
    verifyDownloadToken
} from "../src/auth/jwt";
import jwt from "jsonwebtoken";
import { Hono } from "hono";
import { setRefreshCookie } from "../src/auth/cookie-utils";

describe("JWT Utilities", () => {
    const testSecret = "test-secret-key-for-jwt-testing-1234567890";

    beforeEach(() => {
        // Reset JWT config before each test
        configureJwt({
            secret: testSecret,
            accessExpiresIn: "1h",
            refreshExpiresIn: "30d"
        });
    });

    describe("configureJwt", () => {
        it("should configure JWT with provided secret", () => {
            configureJwt({ secret: "new-secret-key-that-is-at-least-32-chars" });
            // Configuration is internal, but we can verify it works by generating a token
            expect(() => generateAccessToken("user-1", ["admin"])).not.toThrow();
        });

        it("should allow partial configuration updates", () => {
            configureJwt({ secret: testSecret,
accessExpiresIn: "2h" });
            // Token generation should still work
            const token = generateAccessToken("user-1", ["admin"]);
            expect(token).toBeTruthy();
        });
    });

    describe("generateAccessToken", () => {
        it("should generate a valid JWT token", () => {
            const token = generateAccessToken("user-123", ["admin", "editor"]);
            expect(token).toBeTruthy();
            expect(typeof token).toBe("string");
            // JWT tokens have 3 parts separated by dots
            expect(token.split(".")).toHaveLength(3);
        });

        it("should throw error if secret is empty", () => {
            expect(() => configureJwt({ secret: "" }))
                .toThrow("JWT secret is too short");
        });

        it("should include uid and roles in payload", () => {
            const token = generateAccessToken("user-456", ["viewer"]);
            const payload = verifyAccessToken(token);
            expect(payload).toEqual({
                uid: "user-456",
                roles: ["viewer"],
                aal: "aal1",
                // Carried through verification so that revocation can compare it
                // against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number)
            });
        });

        it("should handle empty roles array", () => {
            const token = generateAccessToken("user-789", []);
            const payload = verifyAccessToken(token);
            expect(payload?.roles).toEqual([]);
        });
    });

    describe("verifyAccessToken", () => {
        it("should verify and decode a valid token", () => {
            const token = generateAccessToken("user-123", ["admin"]);
            const payload = verifyAccessToken(token);
            expect(payload).toEqual({
                uid: "user-123",
                roles: ["admin"],
                aal: "aal1",
                // Carried through verification so that revocation can compare it
                // against the user\'s `tokensValidAfter` watermark.
                iat: expect.any(Number)
            });
        });

        it("should return null for invalid token", () => {
            const payload = verifyAccessToken("invalid-token");
            expect(payload).toBeNull();
        });

        it("refuses a download token, which is validly signed but is not a session", () => {
            // Same secret signs both, so the signature proves nothing about what
            // the token is *for*. A download token travels in URLs and is scoped
            // to one file; it must never come back as a user.
            const download = generateDownloadToken("default/uploads/image.png");
            expect(verifyAccessToken(download)).toBeNull();
        });

        it("should return null for token signed with different secret", () => {
            const token = generateAccessToken("user-123", ["admin"]);
            configureJwt({ secret: "different-secret-that-is-at-least-32-chars-long" });
            const payload = verifyAccessToken(token);
            expect(payload).toBeNull();
        });

        it("should return null for malformed JWT", () => {
            const payload = verifyAccessToken("not.a.valid.jwt.token");
            expect(payload).toBeNull();
        });

        it("should throw error if secret is empty", () => {
            expect(() => configureJwt({ secret: "" }))
                .toThrow("JWT secret is too short");
        });
    });

    describe("generateRefreshToken", () => {
        it("should generate a random token", () => {
            const token = generateRefreshToken();
            expect(token).toBeTruthy();
            expect(typeof token).toBe("string");
            // 40 random bytes = 80 hex characters
            expect(token).toHaveLength(80);
        });

        it("should generate unique tokens each time", () => {
            const token1 = generateRefreshToken();
            const token2 = generateRefreshToken();
            expect(token1).not.toBe(token2);
        });
    });

    describe("hashRefreshToken", () => {
        it("should hash a token consistently", () => {
            const token = "test-refresh-token";
            const hash1 = hashRefreshToken(token);
            const hash2 = hashRefreshToken(token);
            expect(hash1).toBe(hash2);
        });

        it("should produce different hashes for different tokens", () => {
            const hash1 = hashRefreshToken("token1");
            const hash2 = hashRefreshToken("token2");
            expect(hash1).not.toBe(hash2);
        });

        it("should return a SHA256 hash (64 hex characters)", () => {
            const hash = hashRefreshToken("any-token");
            expect(hash).toHaveLength(64);
            expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
        });
    });

    describe("getAccessTokenExpiryMs", () => {
        it("should return correct milliseconds for hours", () => {
            configureJwt({ secret: testSecret,
accessExpiresIn: "2h" });
            expect(getAccessTokenExpiryMs()).toBe(2 * 60 * 60 * 1000);
        });

        it("should return correct milliseconds for days", () => {
            configureJwt({ secret: testSecret,
accessExpiresIn: "7d" });
            expect(getAccessTokenExpiryMs()).toBe(7 * 24 * 60 * 60 * 1000);
        });

        it("should return correct milliseconds for minutes", () => {
            configureJwt({ secret: testSecret,
accessExpiresIn: "30m" });
            expect(getAccessTokenExpiryMs()).toBe(30 * 60 * 1000);
        });

        it("should return correct milliseconds for seconds", () => {
            configureJwt({ secret: testSecret,
accessExpiresIn: "300s" });
            expect(getAccessTokenExpiryMs()).toBe(300 * 1000);
        });

        it("should default to 1 hour for invalid format", () => {
            configureJwt({ secret: testSecret,
accessExpiresIn: "invalid" });
            expect(getAccessTokenExpiryMs()).toBe(60 * 60 * 1000);
        });
    });

    describe("getAccessTokenExpiry", () => {
        it("should return a timestamp in the future", () => {
            const now = Date.now();
            const expiry = getAccessTokenExpiry();
            expect(expiry).toBeGreaterThan(now);
        });

        it("should match the configured expiry duration", () => {
            configureJwt({ secret: testSecret,
accessExpiresIn: "1h" });
            const now = Date.now();
            const expiry = getAccessTokenExpiry();
            // Should be approximately 1 hour from now (with small tolerance)
            const expectedExpiry = now + (60 * 60 * 1000);
            expect(expiry).toBeGreaterThanOrEqual(expectedExpiry - 1000);
            expect(expiry).toBeLessThanOrEqual(expectedExpiry + 1000);
        });
    });

    describe("getRefreshTokenExpiry", () => {
        it("should return a Date in the future", () => {
            const expiry = getRefreshTokenExpiry();
            expect(expiry).toBeInstanceOf(Date);
            expect(expiry.getTime()).toBeGreaterThan(Date.now());
        });

        it("should return approximately 30 days from now by default", () => {
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (30 * 24 * 60 * 60 * 1000);
            // Allow 1 second tolerance
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should respect custom refresh expiry configuration", () => {
            configureJwt({ secret: testSecret,
refreshExpiresIn: "7d" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (7 * 24 * 60 * 60 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should handle hour-based refresh expiry", () => {
            configureJwt({ secret: testSecret,
refreshExpiresIn: "24h" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (24 * 60 * 60 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should handle minute-based refresh expiry", () => {
            configureJwt({ secret: testSecret,
refreshExpiresIn: "90m" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (90 * 60 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should handle second-based refresh expiry", () => {
            configureJwt({ secret: testSecret,
refreshExpiresIn: "3600s" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (3600 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should default to the 400-day cookie ceiling for invalid refresh format", () => {
            configureJwt({ secret: testSecret,
refreshExpiresIn: "invalid" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (400 * 24 * 60 * 60 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("caps the cookie Max-Age at what browsers actually honour", async () => {
            // Config may ask for more; Chrome and RFC 6265bis rewrite anything
            // past 400 days, so the cookie must not claim otherwise.
            //
            // The cap has to be read off the header the server actually sends.
            // This test used to apply `Math.min` itself and assert the result,
            // which measured the test's own arithmetic — `setRefreshCookie` could
            // have emitted ten years and nothing here would have noticed.
            configureJwt({ secret: testSecret,
refreshExpiresIn: "3650d" });
            expect(getRefreshTokenTtlMs()).toBe(3650 * 24 * 60 * 60 * 1000);

            const app = new Hono();
            app.get("/", (c) => {
                setRefreshCookie(c as never, "refresh-token-value", { cookieName: "__rb_refresh" });
                return c.body(null);
            });

            const cookie = (await app.request("/")).headers.get("set-cookie") ?? "";
            const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
            expect(maxAge).toBe(MAX_COOKIE_AGE_MS / 1000);
        });

        it("uses the configured TTL for the cookie when it is under the ceiling", async () => {
            // The other half of the cap: it is a ceiling, not a fixed value.
            // Without this, `Max-Age` could be hardcoded to 400 days and pass.
            configureJwt({ secret: testSecret,
refreshExpiresIn: "7d" });

            const app = new Hono();
            app.get("/", (c) => {
                setRefreshCookie(c as never, "refresh-token-value", { cookieName: "__rb_refresh" });
                return c.body(null);
            });

            const cookie = (await app.request("/")).headers.get("set-cookie") ?? "";
            const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
            expect(maxAge).toBe(7 * 24 * 60 * 60);
        });
    });

    // ── Weak secret rejection ────────────────────────────────
    describe("configureJwt — weak secret rejection", () => {
        it("should reject known weak secret 'secret'", () => {
            expect(() => configureJwt({ secret: "secret".padEnd(32, "x") })).not.toThrow();
            // But the actual word "secret" is too short AND is a known weak value
            expect(() => configureJwt({ secret: "secret" })).toThrow("JWT secret is too short");
        });

        it("should reject known weak secrets like 'changeme'", () => {
            // 'changeme' is only 8 chars, fails the length check first
            expect(() => configureJwt({ secret: "changeme" })).toThrow("JWT secret is too short");
        });

        // Every candidate above is under 32 characters, so the length check
        // answers first and the weak-secret list is never consulted — deleting
        // it left this whole describe green. These two are the only cases where
        // the list is what refuses, which is the case that matters: the defaults
        // people actually ship are long enough to look fine.
        it("rejects a known weak secret that is long enough to pass the length check", () => {
            expect(() => configureJwt({ secret: "your-super-secret-jwt-key-change-in-production" }))
                .toThrow("known default/weak value");
        });

        it("rejects a known weak secret regardless of casing", () => {
            // The lookup lowercases first, so shouting the default is still the default.
            expect(() => configureJwt({ secret: "REBASE_SAAS_JWT_SECRET_MUST_BE_LONG_LONG_LONG_LONG" }))
                .toThrow("known default/weak value");
        });

        it("should reject secret that is exactly 31 characters", () => {
            const shortSecret = "a".repeat(31);
            expect(() => configureJwt({ secret: shortSecret })).toThrow("JWT secret is too short");
        });

        it("should accept secret that is exactly 32 characters", () => {
            const validSecret = "a".repeat(32);
            expect(() => configureJwt({ secret: validSecret })).not.toThrow();
        });

        it("should accept long randomly generated secrets", () => {
            const longSecret = "aB3dEfGhIjKlMnOpQrStUvWxYz012345678901234567890";
            expect(() => configureJwt({ secret: longSecret })).not.toThrow();
        });
    });

    // ── Expired token ────────────────────────────────────────
    describe("expired token handling", () => {
        it("should return null for an expired token", () => {
            // This test asserted that the token was *valid* and left a comment
            // saying expiry could not easily be waited for. It can: the clock
            // `jsonwebtoken` compares `exp` against is `Date.now()`, which fake
            // timers own. A `verifyAccessToken` that dropped `expiresIn`, or
            // passed `ignoreExpiration`, used to pass this.
            configureJwt({ secret: testSecret,
accessExpiresIn: "1s" });
            const token = generateAccessToken("user-1", ["admin"]);

            const payload = verifyAccessToken(token);
            expect(payload).not.toBeNull();
            expect(payload!.uid).toBe("user-1");
            expect(payload!.roles).toEqual(["admin"]);

            jest.useFakeTimers().setSystemTime(Date.now() + 2_000);
            try {
                expect(verifyAccessToken(token)).toBeNull();
            } finally {
                jest.useRealTimers();
            }
        });
    });

    // ── Access token round-trip with various roles ────────────
    describe("access token round-trip", () => {
        it("should preserve multiple roles through encode/decode", () => {
            const roles = ["admin", "editor", "viewer", "moderator"];
            const token = generateAccessToken("user-multi", roles);
            const payload = verifyAccessToken(token);
            expect(payload!.uid).toBe("user-multi");
            expect(payload!.roles).toEqual(roles);
        });

        it("should handle special characters in uid", () => {
            const token = generateAccessToken("user@example.com", ["admin"]);
            const payload = verifyAccessToken(token);
            expect(payload!.uid).toBe("user@example.com");
        });

        it("should handle UUID-style uid", () => {
            const uuid = "550e8400-e29b-41d4-a716-446655440000";
            const token = generateAccessToken(uuid, []);
            const payload = verifyAccessToken(token);
            expect(payload!.uid).toBe(uuid);
        });
    });

    // ── Scoped Download Tokens ────────────────────────────────
    describe("Scoped Download Tokens", () => {
        it("should generate a valid scoped download token", () => {
            const token = generateDownloadToken("default/photos/file.jpg", 100);
            expect(token).toBeTruthy();
            expect(typeof token).toBe("string");
        });

        it("should verify and decode a valid scoped download token", () => {
            const token = generateDownloadToken("default/photos/file.jpg", 100);
            const decoded = verifyDownloadToken(token);
            expect(decoded).toEqual({
                purpose: "file-read",
                path: "default/photos/file.jpg",
                storageId: "(default)"
            });
        });

        it("carries the storage source it was minted for", () => {
            // The path alone does not identify an object: the same key exists
            // independently in every configured source.
            const token = generateDownloadToken("default/photos/file.jpg", 100, "media");
            expect(verifyDownloadToken(token)!.storageId).toBe("media");
        });

        it("spells the default source one way, however it was asked for", () => {
            // `?storageId=` omitted, empty, and `(default)` all resolve to the
            // same controller, so all three must produce the same grant — else
            // the check either 403s a legitimate read or gets skipped.
            for (const asked of [undefined, null, "", "   ", "(default)"] as const) {
                const token = generateDownloadToken("default/photos/file.jpg", 100, asked);
                expect(verifyDownloadToken(token)!.storageId).toBe("(default)");
            }
        });

        it("reads a token minted before the storageId claim as a default-source grant", () => {
            // Fail-closed for the five minutes an old token can still be in
            // flight after a deploy: it grants the default source, not all of
            // them. Signed by hand because the current minter cannot omit the
            // claim — which is the point of the test.
            const legacy = jwt.sign(
                { purpose: "file-read", path: "default/photos/file.jpg" },
                testSecret,
                { expiresIn: 100, algorithm: "HS256" }
            );
            expect(verifyDownloadToken(legacy)!.storageId).toBe("(default)");
        });

        it("should return null when verifying an access token as a download token", () => {
            const accessToken = generateAccessToken("user-1", ["admin"]);
            const decoded = verifyDownloadToken(accessToken);
            expect(decoded).toBeNull();
        });

        it("should return null for a malformed download token", () => {
            expect(verifyDownloadToken("invalid.download.token")).toBeNull();
        });

        it("should return null for expired download tokens", () => {
            // Expiry is the whole point of a download token: it travels in a URL
            // that ends up in logs, Referer headers and chat messages, so the
            // window in which a leaked one is useful has to be short. This test
            // used to hand in a malformed string, which the signature check
            // rejects long before `exp` is ever looked at.
            const token = generateDownloadToken("default/photos/file.jpg", 1);
            expect(verifyDownloadToken(token)).not.toBeNull();

            jest.useFakeTimers().setSystemTime(Date.now() + 2_000);
            try {
                expect(verifyDownloadToken(token)).toBeNull();
            } finally {
                jest.useRealTimers();
            }
        });
    });
});

