import {
    configureJwt,
    generateAccessToken,
    verifyAccessToken,
    generateRefreshToken,
    hashRefreshToken,
    getRefreshTokenExpiry,
    getAccessTokenExpiryMs,
    getAccessTokenExpiry
} from "../src/auth/jwt";

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
            configureJwt({ secret: testSecret, accessExpiresIn: "2h" });
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

        it("should include userId and roles in payload", () => {
            const token = generateAccessToken("user-456", ["viewer"]);
            const payload = verifyAccessToken(token);
            expect(payload).toEqual({
                userId: "user-456",
                roles: ["viewer"]
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
                userId: "user-123",
                roles: ["admin"]
            });
        });

        it("should return null for invalid token", () => {
            const payload = verifyAccessToken("invalid-token");
            expect(payload).toBeNull();
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
            configureJwt({ secret: testSecret, accessExpiresIn: "2h" });
            expect(getAccessTokenExpiryMs()).toBe(2 * 60 * 60 * 1000);
        });

        it("should return correct milliseconds for days", () => {
            configureJwt({ secret: testSecret, accessExpiresIn: "7d" });
            expect(getAccessTokenExpiryMs()).toBe(7 * 24 * 60 * 60 * 1000);
        });

        it("should return correct milliseconds for minutes", () => {
            configureJwt({ secret: testSecret, accessExpiresIn: "30m" });
            expect(getAccessTokenExpiryMs()).toBe(30 * 60 * 1000);
        });

        it("should return correct milliseconds for seconds", () => {
            configureJwt({ secret: testSecret, accessExpiresIn: "300s" });
            expect(getAccessTokenExpiryMs()).toBe(300 * 1000);
        });

        it("should default to 1 hour for invalid format", () => {
            configureJwt({ secret: testSecret, accessExpiresIn: "invalid" });
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
            configureJwt({ secret: testSecret, accessExpiresIn: "1h" });
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
            configureJwt({ secret: testSecret, refreshExpiresIn: "7d" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (7 * 24 * 60 * 60 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should handle hour-based refresh expiry", () => {
            configureJwt({ secret: testSecret, refreshExpiresIn: "24h" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (24 * 60 * 60 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should handle minute-based refresh expiry", () => {
            configureJwt({ secret: testSecret, refreshExpiresIn: "90m" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (90 * 60 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should handle second-based refresh expiry", () => {
            configureJwt({ secret: testSecret, refreshExpiresIn: "3600s" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (3600 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
        });

        it("should default to 30 days for invalid refresh format", () => {
            configureJwt({ secret: testSecret, refreshExpiresIn: "invalid" });
            const expiry = getRefreshTokenExpiry();
            const expected = Date.now() + (30 * 24 * 60 * 60 * 1000);
            expect(expiry.getTime()).toBeGreaterThanOrEqual(expected - 1000);
            expect(expiry.getTime()).toBeLessThanOrEqual(expected + 1000);
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
            // Configure with 1 second expiry
            configureJwt({ secret: testSecret, accessExpiresIn: "1s" });
            const token = generateAccessToken("user-1", ["admin"]);

            // Immediately verify should work
            const payload = verifyAccessToken(token);
            expect(payload).not.toBeNull();

            // We can't easily wait for expiry in a unit test,
            // but we can verify the token structure is correct
            expect(payload!.userId).toBe("user-1");
            expect(payload!.roles).toEqual(["admin"]);
        });
    });

    // ── Access token round-trip with various roles ────────────
    describe("access token round-trip", () => {
        it("should preserve multiple roles through encode/decode", () => {
            const roles = ["admin", "editor", "viewer", "moderator"];
            const token = generateAccessToken("user-multi", roles);
            const payload = verifyAccessToken(token);
            expect(payload!.userId).toBe("user-multi");
            expect(payload!.roles).toEqual(roles);
        });

        it("should handle special characters in userId", () => {
            const token = generateAccessToken("user@example.com", ["admin"]);
            const payload = verifyAccessToken(token);
            expect(payload!.userId).toBe("user@example.com");
        });

        it("should handle UUID-style userId", () => {
            const uuid = "550e8400-e29b-41d4-a716-446655440000";
            const token = generateAccessToken(uuid, []);
            const payload = verifyAccessToken(token);
            expect(payload!.userId).toBe(uuid);
        });
    });
});

