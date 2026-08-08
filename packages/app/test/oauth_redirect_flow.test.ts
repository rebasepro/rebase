/**
 * The browser half of the OAuth flow that the admin login used to skip
 * entirely: no `state` on the authorize URL, and a return leg that accepted
 * any `?code=` as long as a localStorage marker naming the provider was set.
 */

import { webcrypto } from "crypto";

// jsdom ships `crypto.getRandomValues` but no SubtleCrypto; PKCE needs the
// SHA-256 digest, which every real browser has.
if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

import {
    buildOAuthAuthorization,
    consumeOAuthCallback,
    readPendingOAuthRedirect,
    type PendingOAuthRedirect
} from "../src/components/LoginView/oauth-redirect-flow";

function memoryStorage() {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => { map.set(k, v); },
        removeItem: (k: string) => { map.delete(k); },
        size: () => map.size
    };
}

function store(storage: ReturnType<typeof memoryStorage>, pending: PendingOAuthRedirect) {
    storage.setItem("rebase_oauth_redirect", JSON.stringify(pending));
}

const REDIRECT = "https://admin.example.com/";

const BASE_REQUEST = {
    provider: "github",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    clientId: "client-123",
    redirectUri: REDIRECT,
    scope: "read:user,user:email"
};

describe("buildOAuthAuthorization", () => {
    it("puts a state parameter on the authorize URL and remembers it", async () => {
        const { url, pending } = await buildOAuthAuthorization(BASE_REQUEST);
        const state = new URL(url).searchParams.get("state");

        expect(state).toBeTruthy();
        expect(state!.length).toBeGreaterThanOrEqual(32);
        expect(pending.state).toBe(state);
        expect(pending.provider).toBe("github");
    });

    it("generates a different state for every authorization", async () => {
        const a = await buildOAuthAuthorization(BASE_REQUEST);
        const b = await buildOAuthAuthorization(BASE_REQUEST);
        expect(a.pending.state).not.toBe(b.pending.state);
    });

    it("carries the standard authorize parameters", async () => {
        const { url } = await buildOAuthAuthorization(BASE_REQUEST);
        const params = new URL(url).searchParams;
        expect(params.get("response_type")).toBe("code");
        expect(params.get("client_id")).toBe("client-123");
        expect(params.get("redirect_uri")).toBe(REDIRECT);
        expect(params.get("scope")).toBe("read:user,user:email");
    });

    it("adds an S256 PKCE challenge only when the provider supports it", async () => {
        const without = await buildOAuthAuthorization(BASE_REQUEST);
        expect(new URL(without.url).searchParams.get("code_challenge")).toBeNull();
        expect(without.pending.codeVerifier).toBeUndefined();

        const withPkce = await buildOAuthAuthorization({ ...BASE_REQUEST, pkce: true });
        const params = new URL(withPkce.url).searchParams;
        expect(params.get("code_challenge_method")).toBe("S256");
        expect(params.get("code_challenge")).toBeTruthy();
        // The challenge is the hash, never the verifier itself.
        expect(params.get("code_challenge")).not.toBe(withPkce.pending.codeVerifier);
        expect(withPkce.pending.codeVerifier).toBeTruthy();
    });
});

describe("consumeOAuthCallback", () => {
    const now = 1_700_000_000_000;

    function pending(overrides: Partial<PendingOAuthRedirect> = {}): PendingOAuthRedirect {
        return { provider: "github", state: "the-state", redirectUri: REDIRECT, startedAt: now, ...overrides };
    }

    it("returns 'none' when the URL carries no callback", () => {
        const storage = memoryStorage();
        expect(consumeOAuthCallback("?foo=bar", storage, now).status).toBe("none");
    });

    it("accepts a code whose state matches the pending authorization", () => {
        const storage = memoryStorage();
        store(storage, pending());

        const result = consumeOAuthCallback("?code=abc&state=the-state", storage, now);

        expect(result).toEqual({
            status: "ok",
            provider: "github",
            code: "abc",
            codeVerifier: undefined,
            redirectUri: REDIRECT
        });
    });

    it("rejects an injected code that carries no state", () => {
        // The login-CSRF shape: the attacker's own code, delivered to a victim
        // whose browser has a pending authorization.
        const storage = memoryStorage();
        store(storage, pending());

        expect(consumeOAuthCallback("?code=attacker-code", storage, now).status).toBe("mismatch");
    });

    it("rejects a code whose state does not match", () => {
        const storage = memoryStorage();
        store(storage, pending());

        expect(consumeOAuthCallback("?code=attacker-code&state=guessed", storage, now).status).toBe("mismatch");
    });

    it("rejects a code when this browser started no authorization at all", () => {
        const storage = memoryStorage();
        expect(consumeOAuthCallback("?code=attacker-code&state=anything", storage, now).status).toBe("mismatch");
    });

    it("rejects a code against an authorization that has gone stale", () => {
        const storage = memoryStorage();
        store(storage, pending());

        const anHourLater = now + 60 * 60 * 1000;
        expect(consumeOAuthCallback("?code=abc&state=the-state", storage, anHourLater).status).toBe("mismatch");
    });

    it("clears the pending authorization on a declined consent screen", () => {
        // The abandoned-flow case: the marker used to survive indefinitely,
        // leaving the browser primed to accept an injected code later.
        const storage = memoryStorage();
        store(storage, pending());

        const result = consumeOAuthCallback("?error=access_denied", storage, now);

        expect(result).toEqual({ status: "error", error: "access_denied" });
        expect(readPendingOAuthRedirect(storage)).toBeNull();
    });

    it("clears the pending authorization on every return path, success included", () => {
        for (const search of ["?code=abc&state=the-state", "?code=abc&state=wrong", "?error=access_denied"]) {
            const storage = memoryStorage();
            store(storage, pending());
            consumeOAuthCallback(search, storage, now);
            expect(readPendingOAuthRedirect(storage)).toBeNull();
        }
    });

    it("hands the PKCE verifier back exactly once, for the token exchange", () => {
        const storage = memoryStorage();
        store(storage, pending({ codeVerifier: "the-verifier" }));

        const first = consumeOAuthCallback("?code=abc&state=the-state", storage, now);
        expect(first).toMatchObject({ status: "ok", codeVerifier: "the-verifier" });

        // Replaying the same URL finds nothing left to spend it with.
        expect(consumeOAuthCallback("?code=abc&state=the-state", storage, now).status).toBe("mismatch");
    });
});
