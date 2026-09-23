import { describe, it, expect, jest } from "@jest/globals";
import { createAuth, createMemoryStorage } from "../src/auth";
import { createTransport, RebaseApiError } from "../src/transport";
import type { AuthChangeEvent, RebaseSession } from "@rebasepro/types";

/**
 * A sign-in by an account with a second factor does not answer with a session.
 * It answers `401 MFA_REQUIRED` with a short-lived `mfaToken`, and the session
 * comes from answering a challenge — two routes that take that token as their
 * Bearer credential and refuse it everywhere else.
 *
 * The token is sent on those two requests and nowhere else. Installing it on
 * the transport would send it on every request the app makes while the code
 * step is open, and leave it there if the step is abandoned.
 *
 * Real transport, fake `fetch`: the `Authorization` header each request
 * actually carried is what is asserted.
 */

const HOUR = 3_600_000;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

function tokenResponse(accessToken: string, uid = "u1"): Response {
    return jsonResponse({
        tokens: { accessToken, refreshToken: `refresh-${accessToken}`, accessTokenExpiresAt: Date.now() + HOUR },
        user: { uid, email: `${uid}@example.test` }
    });
}

function errorResponse(status: number, code: string, details?: unknown): Response {
    return jsonResponse({ error: { message: code, code, ...(details ? { details } : {}) } }, status);
}

const MFA_REQUIRED = {
    mfaToken: "pending-1",
    factors: [{ id: "f1", factorType: "totp", friendlyName: "Phone" }]
};

function url(input: string | URL | Request): string {
    return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** A backend that answers each route with the next response queued for it. */
function backend(routes: Record<string, Array<() => Response>>) {
    const calls: Array<{ path: string; authorization: string | undefined; init: RequestInit | undefined }> = [];
    const fetchFn = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(url(input)).pathname.replace(/^\/api/, "");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ path, authorization: headers.Authorization, init });
        const next = routes[path]?.shift();
        return next ? next() : jsonResponse({ data: [] });
    });
    return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

function setup(routes: Record<string, Array<() => Response>>, options?: { authFlowMode?: "json" | "cookie" }) {
    const { fetchFn, calls } = backend(routes);
    const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchFn });
    const auth = createAuth(transport, {
        storage: createMemoryStorage(),
        autoRefresh: false,
        authFlowMode: options?.authFlowMode
    });
    const events: Array<{ event: AuthChangeEvent; session: RebaseSession | null }> = [];
    auth.onAuthStateChange((event, session) => events.push({ event, session }));
    const authorizationOf = (path: string) => calls.filter(c => c.path === path).map(c => c.authorization);
    return { auth, transport, calls, events, authorizationOf };
}

describe("finishing a sign-in that answered MFA_REQUIRED", () => {
    it("sends the pending token on the challenge request and on nothing after it", async () => {
        const { auth, transport, authorizationOf } = setup({
            "/auth/login": [() => errorResponse(401, "MFA_REQUIRED", MFA_REQUIRED)],
            "/auth/mfa/challenge": [() => jsonResponse({ challengeId: "ch1", factorId: "f1", expiresAt: "later" })]
        });

        const refusal = await auth.signInWithEmail("u1@example.test", "pw").catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(RebaseApiError);
        expect((refusal as RebaseApiError).code).toBe("MFA_REQUIRED");

        const challenge = await auth.mfa.challenge("f1", { mfaToken: "pending-1" });
        await transport.request("/data/posts");

        expect(challenge.challengeId).toBe("ch1");
        expect(authorizationOf("/auth/mfa/challenge")).toEqual(["Bearer pending-1"]);
        // The app's next request goes out as nobody, which is what the
        // client still is.
        expect(authorizationOf("/data/posts")).toEqual([undefined]);
        expect(auth.getSession()).toBeNull();
    });

    it("adopts the session the verified challenge mints, and says SIGNED_IN", async () => {
        const { auth, transport, events, authorizationOf } = setup({
            "/auth/mfa/challenge/verify": [() => tokenResponse("aal2-access")]
        });

        const result = await auth.mfa.verifyChallenge("ch1", "418293", { mfaToken: "pending-1" });
        await transport.request("/data/posts");

        expect(authorizationOf("/auth/mfa/challenge/verify")).toEqual(["Bearer pending-1"]);
        expect(result.accessToken).toBe("aal2-access");
        expect(auth.getSession()?.accessToken).toBe("aal2-access");
        expect(auth.getSession()?.user.uid).toBe("u1");
        expect(events.map(e => e.event)).toEqual(["SIGNED_IN"]);
        // The session's own token from here on — never the pending one.
        expect(authorizationOf("/data/posts")).toEqual(["Bearer aal2-access"]);
    });

    it("leaves the client signed out, and the pending token unsent, when the code is wrong", async () => {
        const { auth, transport, events, authorizationOf } = setup({
            "/auth/mfa/challenge/verify": [() => errorResponse(401, "INVALID_CODE")]
        });

        const refusal = await auth.mfa.verifyChallenge("ch1", "000000", { mfaToken: "pending-1" })
            .catch((e: unknown) => e);
        await transport.request("/data/posts");

        expect(refusal).toBeInstanceOf(RebaseApiError);
        expect((refusal as RebaseApiError).code).toBe("INVALID_CODE");
        expect((refusal as RebaseApiError).status).toBe(401);
        expect(auth.getSession()).toBeNull();
        expect(events).toEqual([]);
        expect(authorizationOf("/data/posts")).toEqual([undefined]);
        // Sent once, as the pending sign-in it is.
        expect(authorizationOf("/auth/mfa/challenge/verify")).toEqual(["Bearer pending-1"]);
    });

    it("sends the pending token in place of a session the client already holds, and keeps that session", async () => {
        const { auth, transport, authorizationOf } = setup({
            "/auth/login": [() => tokenResponse("held-access")],
            "/auth/mfa/challenge": [() => jsonResponse({ challengeId: "ch2", factorId: "f1", expiresAt: "later" })]
        });
        await auth.signInWithEmail("u1@example.test", "pw");

        await auth.mfa.challenge("f1", { mfaToken: "pending-2" });
        await transport.request("/data/posts");

        expect(authorizationOf("/auth/mfa/challenge")).toEqual(["Bearer pending-2"]);
        expect(authorizationOf("/data/posts")).toEqual(["Bearer held-access"]);
        expect(auth.getSession()?.accessToken).toBe("held-access");
    });

    it("lets the refresh cookie land in cookie mode", async () => {
        const { auth, calls } = setup({
            "/auth/mfa/challenge/verify": [() => tokenResponse("aal2-access")]
        }, { authFlowMode: "cookie" });

        await auth.mfa.verifyChallenge("ch1", "418293", { mfaToken: "pending-1" });

        const verify = calls.find(c => c.path === "/auth/mfa/challenge/verify");
        expect(verify?.init?.credentials).toBe("include");
    });

    it("steps up a held session through the transport when no pending token is given", async () => {
        const { auth, authorizationOf } = setup({
            "/auth/login": [() => tokenResponse("held-access")],
            "/auth/mfa/challenge": [() => jsonResponse({ challengeId: "ch3", factorId: "f1", expiresAt: "later" })]
        });
        await auth.signInWithEmail("u1@example.test", "pw");

        await auth.mfa.challenge("f1");

        expect(authorizationOf("/auth/mfa/challenge")).toEqual(["Bearer held-access"]);
    });
});
