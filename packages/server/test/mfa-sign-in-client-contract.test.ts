/**
 * MFA sign-in, client and server together.
 *
 * A sign-in by an enrolled account is refused with `401 MFA_REQUIRED`, and the
 * client finishes it from that refusal's `details`: `mfaToken` is the Bearer
 * credential of the two challenge routes, `factors[].id` the factor to
 * challenge. Both halves had tests, and neither tested the other: the client's
 * (`client/test/auth-mfa-sign-in.test.ts`) answers its fake `fetch` with a
 * `details` object written by hand, and the server's (`mfa-enforcement`) reads
 * the body with its own type. A rename on either side — `mfaToken` to
 * `pendingToken`, `factors[].id` to `factorId` — passed both.
 *
 * Here the real `createRebaseClient` signs in against the real auth routes,
 * reads only what the server's refusal carries, and must end up signed in.
 */

import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { createRebaseClient, RebaseApiError } from "@rebasepro/client";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt } from "../src/auth/jwt";
import { base32Decode, generateTotp, generateTotpSecret } from "../src/auth/mfa";
import { encryptTotpSecret } from "../src/auth/mfa-crypto";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SECRET = "mfa-sign-in-client-contract-secret-32-chars!!";
const ORIGIN = "https://app.example.com";
const EMAIL = "two-factor@example.com";
const PASSWORD = "Str0ng-Passw0rd!";

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    process.env.MFA_ENCRYPTION_KEY = "mfa-client-contract-encryption-key-0123456789";
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

const clients: Array<{ close: () => void }> = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.close();
});

/** What the client is told to read off an `MFA_REQUIRED` refusal, checked rather than assumed. */
function pendingSignIn(details: unknown): { mfaToken: string; factors: Array<{ id: string; factorType: string; friendlyName?: string }> } {
    expect(details).toEqual({
        mfaToken: expect.any(String),
        factors: expect.any(Array)
    });
    const { mfaToken, factors } = details as { mfaToken: string; factors: Array<{ id: string; factorType: string; friendlyName?: string }> };
    for (const factor of factors) {
        expect(factor).toEqual(expect.objectContaining({ id: expect.any(String), factorType: expect.any(String) }));
    }
    return { mfaToken, factors };
}

async function enrolledBackend() {
    const store = new MemoryAuthStore();
    const repo = store.repo();
    const user = await repo.createUser({ email: EMAIL, passwordHash: `hashed:${PASSWORD}`, emailVerified: true });
    const { secret } = generateTotpSecret("ContractApp", EMAIL);
    const factor = await repo.createMfaFactor!(user.id, "totp", encryptTotpSecret(secret), "Phone");
    await repo.verifyMfaFactor!(factor.id);

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/api/auth", createAuthRoutes({ authRepo: repo, authHooks: HOOKS }));

    const serverFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        return app.request(url.pathname + url.search, init);
    }) as typeof fetch;

    const client = createRebaseClient({ baseUrl: ORIGIN, realtime: false, fetch: serverFetch });
    clients.push(client);
    await client.auth.isInitialized();
    return { client, factorId: factor.id, secret, uid: user.id };
}

describe("the client finishes an MFA sign-in from the server's own refusal", () => {
    it("reads mfaToken and factors off MFA_REQUIRED, challenges, verifies, and is signed in", async () => {
        const { client, factorId, secret, uid } = await enrolledBackend();

        const refusal = await client.auth.signInWithEmail(EMAIL, PASSWORD).catch((e: unknown) => e);

        expect(refusal).toBeInstanceOf(RebaseApiError);
        expect((refusal as RebaseApiError).status).toBe(401);
        expect((refusal as RebaseApiError).code).toBe("MFA_REQUIRED");
        expect(client.auth.getSession()).toBeNull();

        const { mfaToken, factors } = pendingSignIn((refusal as RebaseApiError).details);
        expect(factors).toEqual([{ id: factorId, factorType: "totp", friendlyName: "Phone" }]);

        const challenge = await client.auth.mfa.challenge(factors[0].id, { mfaToken });
        expect(challenge.factorId).toBe(factorId);

        const code = await generateTotp(base32Decode(secret));
        const session = await client.auth.mfa.verifyChallenge(challenge.challengeId, code, { mfaToken });

        expect(session.accessToken).toEqual(expect.any(String));
        expect(client.auth.getSession()?.user.uid).toBe(uid);
        expect((await client.auth.getUser()).email).toBe(EMAIL);
    });

    it("leaves the client signed out when the code is wrong", async () => {
        const { client } = await enrolledBackend();
        const refusal = await client.auth.signInWithEmail(EMAIL, PASSWORD).catch((e: unknown) => e);
        const { mfaToken, factors } = pendingSignIn((refusal as RebaseApiError).details);

        const challenge = await client.auth.mfa.challenge(factors[0].id, { mfaToken });
        const wrong = await client.auth.mfa.verifyChallenge(challenge.challengeId, "000000", { mfaToken }).catch((e: unknown) => e);
        expect(wrong).toBeInstanceOf(RebaseApiError);
        expect((wrong as RebaseApiError).status).toBe(401);
        expect(client.auth.getSession()).toBeNull();
    });
});
