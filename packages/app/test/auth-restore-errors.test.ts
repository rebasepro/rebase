/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
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

/**
 * The SDK restores a stored session on its own, and does not always say how
 * it went. An expired stored session is installed while its boot refresh runs;
 * when that refresh is rejected the SDK drops the session and emits nothing.
 * This controller seeded its user from that first `getSession()`, only
 * listened for events after it, and never waited for the restore — so a
 * returning visitor with a revoked refresh token was rendered signed in, every
 * request 401'd, and nothing would ever sign them out.
 */
describe("useAuthSubscription and the SDK's own session restore", () => {

    function restoringClient(stored: { user: { uid: string } } | null) {
        let current = stored;
        let finishRestore!: (restored: { user: { uid: string } } | null) => void;
        const restored = new Promise<void>(resolve => {
            finishRestore = (next) => {
                current = next;
                resolve();
            };
        });
        const client = {
            getSession: () => current,
            getUser: async () => { throw new RebaseApiError("Unauthorized", { status: 401 }); },
            canRestoreSession: () => true,
            isInitialized: () => restored,
            onAuthStateChange: () => () => { /* unsubscribe */ },
            signOut: async () => { /* noop */ },
            refreshSession: async () => ({ accessToken: "" })
        } as never;
        return { client, finishRestore };
    }

    it("signs out a stored session whose boot refresh was rejected", async () => {
        const { client, finishRestore } = restoringClient({ user: { uid: "u1" } });
        const { result } = renderHook(() => useAuthSubscription(client));

        await act(async () => finishRestore(null));

        expect(result.current.user).toBeNull();
    });

    it("stays loading until the restore settles, even with a session in hand", async () => {
        const { client, finishRestore } = restoringClient({ user: { uid: "u1" } });
        const { result } = renderHook(() => useAuthSubscription(client));

        expect(result.current.initialLoading).toBe(true);

        await act(async () => finishRestore({ user: { uid: "u1" } }));

        expect(result.current.initialLoading).toBe(false);
        expect(result.current.user?.uid).toBe("u1");
    });

    it("picks up a session the restore produced without announcing it", async () => {
        const { client, finishRestore } = restoringClient(null);
        const { result } = renderHook(() => useAuthSubscription(client));

        await act(async () => finishRestore({ user: { uid: "u2" } }));

        expect(result.current.user?.uid).toBe("u2");
        expect(result.current.initialLoading).toBe(false);
    });
});
