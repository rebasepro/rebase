import { renderHook, act } from "@testing-library/react";
import type { AuthChangeEvent, AuthClient, RebaseSession, User } from "@rebasepro/types";
import { useRebaseAuthController } from "../../src/auth/useRebaseAuthController";
import { useAuthSubscription } from "../../src/hooks/useAuthSubscription";
import { clearSessionCaches } from "../../src/auth/session_caches";
import { useScrollRestoration } from "../../src/components/common/useScrollRestoration";
import { entityDisplayKey, getSharedEntityDisplayCache } from "../../src/collections/entity-display-cache";
import {
    getEntityFromCache,
    getEntityFromMemoryCache,
    saveEntityToCache,
    saveEntityToMemoryCache
} from "../../src/util/entity_cache";

/**
 * Everything the admin keeps between views, for the user it was read as.
 *
 * Sign-out used to clear the fetch cache and nothing else. The table's scroll
 * cache still held the last user's rows — and the next user's table seeds its
 * first render from it, then keeps those rows when its own read is refused, so
 * a user with no access to `salaries` was shown the previous user's salaries.
 * The display cache (relation chip titles) and the in-memory edit handoff were
 * never cleared either, and the fallback controller that `<Rebase client>`
 * builds when it is given no `authController` did not clear anything at all.
 *
 * Local drafts are the one exception, and on purpose: a sign-out is also what a
 * rejected refresh token looks like, and the draft backup exists for exactly
 * that user coming back. They go when somebody *else* signs in.
 */

type Listener = (event: AuthChangeEvent, session: RebaseSession | null) => void;

function user(uid: string): User {
    return {
        uid,
        email: `${uid}@rebase.pro`,
        displayName: uid,
        photoURL: null,
        providerId: "password",
        isAnonymous: false,
        roles: []
    };
}

function session(uid: string): RebaseSession {
    return {
        accessToken: `access-${uid}`,
        refreshToken: `refresh-${uid}`,
        expiresAt: Date.now() + 3600_000,
        user: user(uid)
    };
}

/** An SDK auth whose events the test delivers by hand. */
function fakeAuth() {
    const listeners = new Set<Listener>();
    let current: RebaseSession | null = null;
    const auth = {
        getSession: () => current,
        getUser: async () => current?.user ?? null,
        canRestoreSession: () => false,
        onAuthStateChange: (listener: Listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        isInitialized: async () => undefined,
        getAuthConfig: async () => ({ needsSetup: false, registrationEnabled: true, enabledProviders: [] }),
        signOut: async () => undefined,
        refreshSession: async () => {
            throw new Error("not used");
        }
    };
    const emit = async (event: AuthChangeEvent, next: RebaseSession | null) => {
        current = next;
        await act(async () => {
            for (const listener of [...listeners]) listener(event, next);
        });
    };
    return { auth, emit };
}

const controllers = {
    "useRebaseAuthController": (auth: ReturnType<typeof fakeAuth>["auth"]) =>
        renderHook(() => useRebaseAuthController({ client: { auth: auth as never } })),
    "useAuthSubscription (no authController given)": (auth: ReturnType<typeof fakeAuth>["auth"]) =>
        renderHook(() => useAuthSubscription(auth satisfies AuthClient))
};

const salariesRow = { id: "ceo", path: "salaries", values: { amount: 900000 } };
const displayKey = entityDisplayKey("salaries", "ceo", "title");

function fillSessionCaches() {
    renderHook(() => useScrollRestoration()).result.current.updateCollectionScroll({
        path: "salaries",
        scrollOffset: 120,
        data: [salariesRow]
    });
    saveEntityToMemoryCache("salaries/ceo", { amount: 1 });
    void getSharedEntityDisplayCache().resolve(displayKey, () => "CEO salary");
}

function scrollCacheRows() {
    return renderHook(() => useScrollRestoration()).result.current.getCollectionScroll("salaries")?.data;
}

describe.each(Object.entries(controllers))("session caches and %s", (_name, mount) => {

    beforeEach(() => {
        clearSessionCaches();
        sessionStorage.clear();
    });

    it("drops the previous user's rows, handoffs and display values on sign-out", async () => {
        const { auth, emit } = fakeAuth();
        mount(auth);
        await emit("SIGNED_IN", session("admin"));
        fillSessionCaches();
        expect(scrollCacheRows()).toEqual([salariesRow]);

        await emit("SIGNED_OUT", null);

        expect(scrollCacheRows()).toBeUndefined();
        expect(getEntityFromMemoryCache("salaries/ceo")).toBeUndefined();
        expect(getSharedEntityDisplayCache().peek(displayKey)).toBeUndefined();
    });

    it("drops them when a different user signs in without a sign-out in between", async () => {
        const { auth, emit } = fakeAuth();
        mount(auth);
        await emit("SIGNED_IN", session("admin"));
        fillSessionCaches();

        await emit("SIGNED_IN", session("intern"));

        expect(scrollCacheRows()).toBeUndefined();
        expect(getSharedEntityDisplayCache().peek(displayKey)).toBeUndefined();
    });

    it("keeps them across a token refresh", async () => {
        const { auth, emit } = fakeAuth();
        mount(auth);
        await emit("SIGNED_IN", session("admin"));
        fillSessionCaches();

        await emit("TOKEN_REFRESHED", session("admin"));

        expect(scrollCacheRows()).toEqual([salariesRow]);
        expect(getSharedEntityDisplayCache().peek(displayKey)).toBe("CEO salary");
    });

    it("keeps a local draft for the same user coming back, and drops it for anybody else", async () => {
        const { auth, emit } = fakeAuth();
        mount(auth);
        await emit("SIGNED_IN", session("admin"));
        saveEntityToCache("salaries/ceo", { amount: 1_000_000 });

        await emit("SIGNED_OUT", null);
        await emit("SIGNED_IN", session("admin"));
        expect(getEntityFromCache("salaries/ceo")).toEqual({ amount: 1_000_000 });

        await emit("SIGNED_OUT", null);
        await emit("SIGNED_IN", session("intern"));
        expect(getEntityFromCache("salaries/ceo")).toBeUndefined();
    });
});
