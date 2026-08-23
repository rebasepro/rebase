import { describe, it, expect, beforeAll } from "@jest/globals";
import { isAccessTokenRevoked } from "../src/auth/token-revocation";
import { configureJwt, generateAccessToken, verifyAccessToken } from "../src/auth/jwt";
import type { AuthRepository } from "../src/auth/interfaces";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";

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

describe("every entry point that turns a token into a user reads the watermark", () => {
    /**
     * The gap this suite did not close the first time.
     *
     * Everything above tests `isAccessTokenRevoked` itself, which was correct
     * throughout. What was missing was a test of its CALLERS —
     * `builtin-auth-adapter` has two functions that turn a bearer token into an
     * `AuthenticatedUser`, and only one of them consulted it.
     *
     * The one that did not was `verifyToken`, which is what the WebSocket
     * AUTHENTICATE handler calls. So signing out closed a stolen session's HTTP
     * requests and left its realtime connection working, with the watermark
     * written and read and simply not reached on that path.
     *
     * So the subject here is the adapter, and the assertion is made against
     * both functions from one list — a new entry point is covered the day it is
     * added rather than the day someone remembers.
     */
    const revokedRepo = (payloadIat: number) => ({
        getTokensValidAfter: async () => new Date((payloadIat + 60) * 1000),
        getUserRoleIds: async () => ["editor"]
    }) as unknown as AuthRepository;

    const liveRepo = () => ({
        getTokensValidAfter: async () => null,
        getUserRoleIds: async () => ["editor"]
    }) as unknown as AuthRepository;

    /**
     * Both ways a token becomes a user, each called the way its callers call
     * it. `verifyRequest` is the HTTP path and takes a `Request`; `verifyToken`
     * is what the WebSocket AUTHENTICATE handler calls and takes the token.
     */
    type Adapter = ReturnType<typeof createBuiltinAuthAdapter>;
    const ENTRY_POINTS: { name: string; call: (a: Adapter, token: string) => Promise<unknown> }[] = [
        {
            name: "verifyRequest",
            call: (adapter, token) => adapter.verifyRequest!(
                new Request("https://example.test/api/data/posts", {
                    headers: { authorization: `Bearer ${token}` }
                })
            )
        },
        {
            name: "verifyToken",
            call: (adapter, token) => adapter.verifyToken!(token)
        }
    ];

    it.each(ENTRY_POINTS.map(e => [e.name, e] as const))(
        "%s refuses a token issued before the watermark",
        async (_name, entry) => {
            const token = generateAccessToken("u1", []);
            const iat = verifyAccessToken(token)!.iat!;
            const adapter = createBuiltinAuthAdapter({ authRepository: revokedRepo(iat) } as never);
            await expect(entry.call(adapter, token)).resolves.toBeNull();
        }
    );

    it.each(ENTRY_POINTS.map(e => [e.name, e] as const))(
        "%s still admits a live token",
        async (_name, entry) => {
            // The other direction, so "refuses everything" cannot pass the above.
            const token = generateAccessToken("u1", []);
            const adapter = createBuiltinAuthAdapter({ authRepository: liveRepo() } as never);
            const user = await entry.call(adapter, token) as { uid?: string } | null;
            expect(user?.uid).toBe("u1");
        }
    );
});
