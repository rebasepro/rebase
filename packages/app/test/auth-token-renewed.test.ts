/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useAuthSubscription } from "../src/hooks/useAuthSubscription";

/**
 * The token the app's `AuthController.getAuthToken()` hands out.
 *
 * It read `getSession()` and renewed only a token already past its expiry, so
 * one with a second left went out and expired on the way to the server. The
 * client's `getAccessToken()` renews inside a margin, and is what it asks now.
 */
function authClient(overrides: Record<string, unknown>) {
    return {
        getSession: () => ({ accessToken: "held", refreshToken: "", expiresAt: Date.now() + 1_000, user: { uid: "u1" } }),
        getUser: async () => ({ uid: "u1" }),
        canRestoreSession: () => true,
        onAuthStateChange: () => () => { /* unsubscribe */ },
        signOut: async () => { /* noop */ },
        refreshSession: async () => ({ accessToken: "refreshed" }),
        ...overrides
    } as never;
}

describe("useAuthSubscription getAuthToken", () => {
    it("asks the client for its renewed token when it can answer", async () => {
        const { result } = renderHook(() => useAuthSubscription(authClient({ getAccessToken: async () => "renewed" })));
        await waitFor(() => expect(result.current.initialLoading).toBe(false));

        expect(await result.current.getAuthToken()).toBe("renewed");
    });

    it("answers \"\" when the client has no session to give", async () => {
        const { result } = renderHook(() => useAuthSubscription(authClient({ getAccessToken: async () => null })));
        await waitFor(() => expect(result.current.initialLoading).toBe(false));

        expect(await result.current.getAuthToken()).toBe("");
    });

    it("reads the session of a client without getAccessToken, as before", async () => {
        const { result } = renderHook(() => useAuthSubscription(authClient({})));
        await waitFor(() => expect(result.current.initialLoading).toBe(false));

        expect(await result.current.getAuthToken()).toBe("held");
    });
});
