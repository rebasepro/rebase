import { describe, expect, it, jest } from "@jest/globals";
import { createAuth } from "./auth";
import type { Transport } from "./transport";

/**
 * `canRestoreSession()` answers whether a session could turn up that this
 * client has not loaded, and the admin's auth hook skips its `GET /auth/me`
 * probe on mount when the answer is no, because that probe can then only 401.
 *
 * It has to agree with what the client restores on load. A cookie-mode client
 * created with `persistSession: false` restores nothing — it does not ask
 * `/auth/refresh` for the cookie's session — yet it answered `true`, so every
 * mount sent the probe, without a token, to be refused.
 */

function transport(fetchFn: typeof fetch): Transport {
    return {
        request: () => Promise.reject(new Error("not sent through the transport")),
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        baseUrl: "http://api.test",
        apiPath: "/api",
        fetchFn,
        getHeaders: () => ({}),
        resolveToken: async () => null
    };
}

describe("canRestoreSession", () => {
    it("is false for a cookie-mode client that does not persist, which restores nothing on load", async () => {
        const fetchFn = jest.fn<typeof fetch>();
        const auth = createAuth(transport(fetchFn), { authFlowMode: "cookie", persistSession: false });

        await auth.isInitialized();

        expect(fetchFn).not.toHaveBeenCalled();
        expect(auth.restoreOutcome()).toBe("none");
        expect(auth.canRestoreSession()).toBe(false);
    });

    it("is true for a cookie-mode client that persists, which asks the server on load", async () => {
        const fetchFn = jest.fn<typeof fetch>().mockResolvedValue(new Response(
            JSON.stringify({ error: { code: "NO_SESSION", message: "No refresh token presented" } }),
            { status: 401, headers: { "Content-Type": "application/json" } }
        ));
        const auth = createAuth(transport(fetchFn), { authFlowMode: "cookie" });

        await auth.isInitialized();

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(auth.canRestoreSession()).toBe(true);
    });
});
