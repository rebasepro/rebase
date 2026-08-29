import {
    configureJwt,
    generateAccessToken,
    verifyAccessToken,
    generateRefreshToken,
    hashRefreshToken,
    getAccessTokenExpiryMs,
    getRefreshTokenExpiry
} from "../src/auth/jwt";

const STRONG_SECRET = "this-is-a-strong-secret-for-jwt-testing-at-least-32-chars-long";

describe("JWT Security Hardening", () => {

    beforeEach(() => {
        configureJwt({ secret: STRONG_SECRET,
accessExpiresIn: "1h",
refreshExpiresIn: "30d" });
    });

    // ── Secret validation ───────────────────────────────────
    describe("configureJwt secret validation", () => {
        it("rejects secrets shorter than 32 characters", () => {
            expect(() => configureJwt({ secret: "short" })).toThrow("too short");
        });

        it("rejects empty secret", () => {
            expect(() => configureJwt({ secret: "" })).toThrow("too short");
        });

        it("rejects known weak secrets", () => {
            expect(() => configureJwt({ secret: "your-super-secret-jwt-key-change-in-production" })).toThrow("weak");
        });

        /*
         * Named "rejects 'changeme' and variations", and its body asserted that
         * a variation is *accepted*. The guard is a Set of exact strings, so the
         * name was describing a substring scan that has never existed.
         *
         * Renaming rather than widening the guard: a secret is only weak because
         * it is a published default someone forgot to replace, and a variation
         * is by definition not that string. Matching on substrings would start
         * refusing perfectly good secrets that happen to contain "test" or
         * "password". So the exact-match behaviour is the intended one, and this
         * pins it honestly in both directions.
         */
        it("matches the weak-secret list exactly, after lowercasing", () => {
            // In the list, but caught by the length check first.
            expect(() => configureJwt({ secret: "changeme" })).toThrow("too short");
            // Long enough to reach the list, and in it — this is the case the
            // list exists for, and the one nothing else in this file covered.
            expect(() => configureJwt({ secret: "rebase_saas_jwt_secret_must_be_long_long_long_long" })).toThrow("weak");
            // Same value, shouted: casing is normalised before the lookup.
            expect(() => configureJwt({ secret: "REBASE_SAAS_JWT_SECRET_MUST_BE_LONG_LONG_LONG_LONG" })).toThrow("weak");
            // Merely *containing* a weak word is a different secret, and allowed.
            expect(() => configureJwt({ secret: "changeme-padding-for-32-chars!!!" })).not.toThrow();
        });

        it("accepts strong, random secrets", () => {
            expect(() => configureJwt({
                secret: "aG7x!kL2$mP9#qR5+tU8*wZ0^bD3&fH6"
            })).not.toThrow();
        });
    });

    // ── Token generation ────────────────────────────────────
    describe("token generation", () => {
        it("generates valid JWT with 3 parts", async () => {
            const token = await generateAccessToken("user-1", ["admin"]);
            expect(token.split(".")).toHaveLength(3);
        });

        it("embeds uid and roles in payload", async () => {
            const token = await generateAccessToken("user-42", ["admin", "editor"]);
            const payload = await verifyAccessToken(token);
            expect(payload?.uid).toBe("user-42");
            expect(payload?.roles).toEqual(["admin", "editor"]);
        });

        it("generates different tokens for different users", async () => {
            const t1 = await generateAccessToken("user-1", ["admin"]);
            const t2 = await generateAccessToken("user-2", ["admin"]);
            expect(t1).not.toBe(t2);
        });

        /*
         * This test was, in full: a `defineProperty` that does nothing, followed
         * by two comments saying so ("This won't work since jwtConfig is
         * module-scoped… We'll test via configureJwt + clearing") and no
         * assertion at all. It passed unconditionally, in a file called
         * `jwt-security`, reporting a guard as covered that nothing touched.
         *
         * `jwtConfig` being module-scoped is exactly why the module has to be
         * loaded fresh: `jest.isolateModules` gives a registry where
         * `configureJwt` has never been called, which is the state a server that
         * forgot to configure JWT actually boots into. Reaching for the private
         * `jwtConfig` was the wrong lever; the module boundary is the right one.
         *
         * Worth having for real: the same guard fired in production this week
         * from a second copy of the package whose config had never been set, and
         * every request that hit it failed with this message.
         */
        it("throws when the secret was never configured", async () => {
            // Signing is asynchronous (see `jwt-crypto.ts`), so an unconfigured
            // mint *rejects* rather than throwing synchronously. The guard is
            // the same one; `isolateModules` still has to be entered
            // synchronously, so the fresh copy is captured there and awaited
            // out here.
            let freshJwt: typeof import("../src/auth/jwt") | undefined;
            jest.isolateModules(() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                freshJwt = require("../src/auth/jwt");
            });

            await expect(freshJwt!.generateAccessToken("user-1", ["admin"]))
                .rejects.toThrow("JWT secret not configured");
        });

        it("refuses to verify a token when the secret was never configured", async () => {
            // The verify side has its own guard, and it is the one an
            // unconfigured *reader* hits — a server that mints tokens elsewhere
            // and only checks them here.
            const token = await generateAccessToken("user-1", ["admin"]);

            let freshJwt: typeof import("../src/auth/jwt") | undefined;
            jest.isolateModules(() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                freshJwt = require("../src/auth/jwt");
            });

            await expect(freshJwt!.verifyAccessToken(token))
                .rejects.toThrow("JWT secret not configured");
        });
    });

    // ── Token verification ──────────────────────────────────
    describe("token verification", () => {
        it("verifies a valid token", async () => {
            const token = await generateAccessToken("user-1", ["editor"]);
            const payload = await verifyAccessToken(token);
            expect(payload).not.toBeNull();
            expect(payload!.uid).toBe("user-1");
        });

        it("returns null for tampered token", async () => {
            const token = await generateAccessToken("user-1", ["admin"]);
            const tampered = token.slice(0, -5) + "XXXXX";
            expect(await verifyAccessToken(tampered)).toBeNull();
        });

        it("returns null for garbage string", async () => {
            expect(await verifyAccessToken("not.a.jwt")).toBeNull();
        });

        it("returns null for empty string", async () => {
            expect(await verifyAccessToken("")).toBeNull();
        });

        it("returns null for token signed with different secret", async () => {
            const token = await generateAccessToken("user-1", ["admin"]);
            // Reconfigure with different secret
            configureJwt({ secret: "another-secret-that-is-at-least-32-chars-long-for-test" });
            expect(await verifyAccessToken(token)).toBeNull();
            // Reset
            configureJwt({ secret: STRONG_SECRET });
        });

        it("extracts roles as array", async () => {
            const token = await generateAccessToken("u", ["admin", "editor", "viewer"]);
            const payload = await verifyAccessToken(token);
            expect(payload!.roles).toEqual(["admin", "editor", "viewer"]);
        });

        it("handles empty roles array", async () => {
            const token = await generateAccessToken("u", []);
            const payload = await verifyAccessToken(token);
            expect(payload!.roles).toEqual([]);
        });
    });

    // ── Refresh tokens ──────────────────────────────────────
    describe("refresh tokens", () => {
        it("generates random hex strings", () => {
            const t1 = generateRefreshToken();
            const t2 = generateRefreshToken();
            expect(t1).not.toBe(t2);
            expect(t1.length).toBe(80); // 40 bytes in hex
        });

        it("hashes deterministically (SHA-256)", async () => {
            const token = "test-refresh-token";
            const h1 = await hashRefreshToken(token);
            const h2 = await hashRefreshToken(token);
            expect(h1).toBe(h2);
            expect(h1.length).toBe(64); // SHA-256 hex
        });

        it("different tokens produce different hashes", async () => {
            const h1 = await hashRefreshToken("token-a");
            const h2 = await hashRefreshToken("token-b");
            expect(h1).not.toBe(h2);
        });
    });

    // ── Expiry calculations ─────────────────────────────────
    describe("expiry calculations", () => {
        it("calculates 1h as 3600000ms", () => {
            configureJwt({ secret: STRONG_SECRET,
accessExpiresIn: "1h" });
            expect(getAccessTokenExpiryMs()).toBe(3600000);
        });

        it("calculates 30m as 1800000ms", () => {
            configureJwt({ secret: STRONG_SECRET,
accessExpiresIn: "30m" });
            expect(getAccessTokenExpiryMs()).toBe(1800000);
        });

        it("calculates 7d correctly", () => {
            configureJwt({ secret: STRONG_SECRET,
accessExpiresIn: "7d" });
            expect(getAccessTokenExpiryMs()).toBe(7 * 24 * 60 * 60 * 1000);
        });

        it("defaults to 1h for unparseable duration", () => {
            configureJwt({ secret: STRONG_SECRET,
accessExpiresIn: "invalid" });
            expect(getAccessTokenExpiryMs()).toBe(3600000);
        });

        it("refresh expiry is in the future", () => {
            configureJwt({ secret: STRONG_SECRET,
refreshExpiresIn: "30d" });
            const expiry = getRefreshTokenExpiry();
            expect(expiry.getTime()).toBeGreaterThan(Date.now());
            // Should be approximately 30 days in the future
            const thirtyDays = 30 * 24 * 60 * 60 * 1000;
            expect(expiry.getTime() - Date.now()).toBeCloseTo(thirtyDays, -4);
        });
    });
});
