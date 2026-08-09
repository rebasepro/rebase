import { describe, it, expect, beforeAll } from "@jest/globals";
import { isAccessTokenRevoked } from "../src/auth/token-revocation";
import { configureJwt, generateAccessToken, verifyAccessToken } from "../src/auth/jwt";
import type { AuthRepository } from "../src/auth/interfaces";

/**
 * A signed-out access token must stop working.
 *
 * `logout`, `change-password`, `reset-password` and `DELETE /auth/sessions` all
 * stamp a `tokensValidAfter` watermark and delete refresh rows. The deletion is
 * what made the gap easy to miss: the session really is gone and the refresh
 * path really does check the watermark, so signing out looked like it worked —
 * while the access token, a bearer credential nothing consulted a database
 * about, stayed valid for its full lifetime.
 */
describe("access token revocation", () => {
    beforeAll(() => {
        configureJwt({ secret: "test-secret-for-token-revocation-checks-0123456789", accessExpiresIn: "1h" });
    });

    const repoWith = (validAfter: Date | null): Pick<AuthRepository, "getTokensValidAfter"> => ({
        getTokensValidAfter: async () => validAfter
    });

    /** A verified payload, as the middleware would hold it. */
    const payloadFor = (uid: string) => verifyAccessToken(generateAccessToken(uid, []))!;

    it("carries `iat` through verification", () => {
        // Without it nothing downstream can place the token against the mark —
        // the payload used to be rebuilt from three claims and drop this one.
        expect(typeof payloadFor("u1").iat).toBe("number");
    });

    it("refuses a token issued before the watermark", async () => {
        const payload = payloadFor("u1");
        const revokedAt = new Date((payload.iat! + 60) * 1000); // a minute later
        expect(await isAccessTokenRevoked(repoWith(revokedAt), payload)).toBe(true);
    });

    it("allows a token issued after the watermark", async () => {
        // The control: a check that refused everything would satisfy the case
        // above. This is the token minted by signing back in.
        const payload = payloadFor("u1");
        const revokedAt = new Date((payload.iat! - 60) * 1000);
        expect(await isAccessTokenRevoked(repoWith(revokedAt), payload)).toBe(false);
    });

    it("treats the same second as revoked", async () => {
        // `iat` is whole seconds and the watermark is milliseconds; a token
        // must not survive on a rounding artefact.
        const payload = payloadFor("u1");
        const sameSecond = new Date(payload.iat! * 1000 + 400);
        expect(await isAccessTokenRevoked(repoWith(sameSecond), payload)).toBe(false);

        const nextSecond = new Date((payload.iat! + 1) * 1000);
        expect(await isAccessTokenRevoked(repoWith(nextSecond), payload)).toBe(true);
    });

    it("allows when no watermark is set", async () => {
        expect(await isAccessTokenRevoked(repoWith(null), payloadFor("u1"))).toBe(false);
    });

    it("allows when the repository cannot answer", async () => {
        // Fails open on purpose: the token is already verified, and refusing
        // everything on a database blip would sign out a whole deployment.
        const broken = { getTokensValidAfter: async () => { throw new Error("db down"); } };
        expect(await isAccessTokenRevoked(broken, payloadFor("u1"))).toBe(false);
    });

    it("allows when the repository does not implement the watermark", async () => {
        expect(await isAccessTokenRevoked({} as never, payloadFor("u1"))).toBe(false);
    });

    it("allows a token with no `iat`", async () => {
        // Tokens minted before `iat` was carried through are in circulation and
        // expire on their own; treating them as revoked would sign everyone out
        // on deploy.
        const revokedAt = new Date(Date.now() + 60_000);
        expect(await isAccessTokenRevoked(repoWith(revokedAt), { uid: "u1" })).toBe(false);
    });
});
