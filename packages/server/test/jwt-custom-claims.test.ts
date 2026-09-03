import { describe, it, expect, beforeAll } from "@jest/globals";
import { configureJwt, generateAccessToken, verifyAccessToken } from "../src/auth/jwt";

/**
 * The signed payload, read without verifying.
 *
 * `verifyAccessToken` narrows to the claims the server acts on, so it cannot
 * show what a hook actually got into the token — and `jose` is ESM, which this
 * suite's runner cannot require. Base64url of the middle segment is the whole
 * of what is needed here.
 */
const signedClaims = (token: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

/**
 * What a custom-claims hook may and may not decide.
 *
 * `aal` was already written after the custom claims, because the obvious hook
 * — spread what you were handed, add a field — echoes back everything it was
 * given, and one that merges a user-controlled profile object echoes back
 * whatever that object held. The same argument applies to `uid` and `roles`
 * and they were not covered: `uid` is who the entire request is, down to the
 * identity the database evaluates its RLS policies against, and `roles` is
 * what every admin gate reads.
 */
describe("custom access-token claims", () => {
    beforeAll(() => configureJwt({ secret: "test-secret-key-for-custom-claims-1234567890" }));

    it("cannot rewrite the subject of the token", async () => {
        const token = await generateAccessToken("user-1", ["viewer"], "aal1", {
            uid: "someone-else",
            plan: "pro"
        });

        expect((await verifyAccessToken(token))?.uid).toBe("user-1");
        // And on the wire, since `verifyAccessToken` narrows to the claims the
        // server acts on — the point here is what was signed.
        expect(signedClaims(token).uid).toBe("user-1");
    });

    it("cannot grant roles", async () => {
        const token = await generateAccessToken("user-1", ["viewer"], "aal1", {
            roles: ["admin"]
        });

        expect((await verifyAccessToken(token))?.roles).toEqual(["viewer"]);
        expect(signedClaims(token).roles).toEqual(["viewer"]);
    });

    it("cannot claim a second factor was passed", async () => {
        const token = await generateAccessToken("user-1", ["viewer"], "aal1", {
            aal: "aal2"
        });

        expect((await verifyAccessToken(token))?.aal).toBe("aal1");
        expect(signedClaims(token).aal).toBe("aal1");
    });

    it("still carries the claims a hook legitimately adds", async () => {
        const token = await generateAccessToken("user-1", ["viewer"], "aal1", {
            tenant: "acme",
            locale: "pt-BR"
        });

        const signed = signedClaims(token);
        expect(signed.tenant).toBe("acme");
        expect(signed.locale).toBe("pt-BR");
    });
});
