/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { RebaseApiError } from "@rebasepro/types";
import { useAuthSubscription } from "../src/hooks/useAuthSubscription";

/**
 * What happens when the "who am I?" probe fails for a reason other than
 * "you are not signed in".
 *
 * `useAuthSubscription` caught every failure from `getUser()` with
 * `// Ignore, user just isn't logged in` and left `authError` — which it
 * declares and exposes on the `AuthController` — permanently `undefined`.
 * `Rebase.tsx` renders a full-screen "Error loading auth" view when that field
 * is set, so the screen was unreachable: a backend that is down, misconfigured
 * or unreachable by CORS looked exactly like being logged out, and the app
 * showed the login form.
 *
 * A 401 really is "not signed in" and must stay silent — it is the ordinary
 * first load of an anonymous visitor.
 */
function authClient(getUser: () => Promise<unknown>) {
    return {
        getSession: () => null,
        getUser,
        canRestoreSession: () => true,
        onAuthStateChange: () => () => { /* unsubscribe */ },
        signOut: async () => { /* noop */ },
        refreshSession: async () => ({ accessToken: "" })
    } as never;
}

describe("useAuthSubscription session restore", () => {
    it("stays quiet when the probe says the visitor is not signed in", async () => {
        const { result } = renderHook(() => useAuthSubscription(
            authClient(async () => { throw new RebaseApiError("Unauthorized", { status: 401 }); })
        ));

        await waitFor(() => expect(result.current.initialLoading).toBe(false));
        expect(result.current.authError).toBeUndefined();
    });

    it("reports a probe that failed for any other reason", async () => {
        const { result } = renderHook(() => useAuthSubscription(
            authClient(async () => { throw new RebaseApiError("Internal Server Error", { status: 500 }); })
        ));

        await waitFor(() => expect(result.current.initialLoading).toBe(false));
        expect(result.current.authError).toBeInstanceOf(Error);
    });

    it("reports a network failure, which carries no status at all", async () => {
        // The case that looks most like being logged out and is least like it:
        // the backend is unreachable, so nothing can be said about the session.
        const { result } = renderHook(() => useAuthSubscription(
            authClient(async () => { throw new TypeError("Failed to fetch"); })
        ));

        await waitFor(() => expect(result.current.initialLoading).toBe(false));
        expect(result.current.authError).toBeInstanceOf(Error);
    });

    it("clears a previous error once a probe succeeds", async () => {
        let fail = true;
        const { result, rerender } = renderHook(() => useAuthSubscription(
            authClient(async () => {
                if (fail) throw new RebaseApiError("Internal Server Error", { status: 500 });
                return { uid: "u1" };
            })
        ));

        await waitFor(() => expect(result.current.authError).toBeInstanceOf(Error));
        fail = false;
        rerender();

        await waitFor(() => expect(result.current.authError).toBeUndefined());
    });
});
