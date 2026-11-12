import { renderHook, act } from "@testing-library/react";
import type { AuthChangeEvent, Entity, RebaseSession } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { ClientAuth } from "../../src/auth/types";
import { fakeAuthConfig, fakeClientAuth } from "../helpers/fakes";
import { useRebaseAuthController } from "../../src/auth/useRebaseAuthController";
import { populateFetchCache, clearFetchCache } from "../../src/hooks/data/useFetch";
import { useFetch } from "../../src/hooks/data/useFetch";

/**
 * Entities outlive the session that read them, unless somebody says otherwise.
 *
 * `useFetch`'s cache is module-level and keyed by `path/id` only — no user in
 * the key — and `clearFetchCache` was written for exactly this and then never
 * called by anything. Previews render straight out of that cache (they seed
 * their first state from it), so signing out and back in as somebody else in
 * the same tab showed the second user rows the first one had loaded.
 */

// Inert data client: a cache miss must not turn into a real fetch here. The
// value under test is what `useFetch` seeds its first render with, which is
// the cache and nothing else.
jest.mock("../../src/hooks/data/useData", () => ({
    useData: () => ({ table: () => ({ findById: () => new Promise(() => undefined) }) })
}));

// `useFetch` also reads the whole Rebase context, and this suite renders it with
// no `<Rebase>` above. That used to work by accident: the contexts defaulted to
// `{}`, so every hook answered with an empty object. They say so now, and the
// only part of the context this suite touches is nothing at all.
jest.mock("../../src/hooks/useRebaseContext", () => ({
    useRebaseContext: () => ({})
}));

function mockAuth(onChange: { current?: (e: AuthChangeEvent, s: RebaseSession | null) => void }): ClientAuth {
    return fakeClientAuth({
        getSession: () => null,
        onAuthStateChange: (handler: (e: AuthChangeEvent, s: RebaseSession | null) => void) => {
            onChange.current = handler;
            return () => undefined;
        },
        isInitialized: async () => undefined,
        getAuthConfig: async () => fakeAuthConfig({ needsSetup: false,
registrationEnabled: true,
enabledProviders: [] }),
        signOut: async () => undefined
    });
}

const order: Entity = { id: "1",
path: "orders",
values: { total: 99 } };

/**
 * Deliver an auth event and let the controller's async handler run. `syncState`
 * awaits before it acts, so the assertion has to wait with it.
 */
async function flush(emit: () => void) {
    await act(async () => {
        emit();
    });
}

function collectionAt(path: string): AdminCollection {
    return { slug: path, name: path, properties: {} };
}

/** Whatever the cache currently holds for a key, without fetching. */
function cached(path: string, id: string) {
    let seen: unknown;
    renderHook(() => {
        seen = useFetch({ path,
entityId: id,
collection: collectionAt(path),
useCache: true }).entity;
    });
    return seen;
}

describe("the entity cache and a change of user", () => {

    beforeEach(() => clearFetchCache());

    it("is emptied when the session signs out", async () => {
        populateFetchCache("orders", [order]);
        expect(cached("orders", "1")).toBeDefined();

        const onChange: { current?: (e: AuthChangeEvent, s: RebaseSession | null) => void } = {};
        const client = { auth: mockAuth(onChange) };
        renderHook(() => useRebaseAuthController({ client }));

        await flush(() => onChange.current!("SIGNED_OUT", null));

        expect(cached("orders", "1")).toBeUndefined();
    });

    it("survives an event that is not a sign-out", async () => {
        // Token refreshes fire on a timer; dropping the cache on each one would
        // make every preview in the app flash a skeleton.
        populateFetchCache("orders", [order]);

        const onChange: { current?: (e: AuthChangeEvent, s: RebaseSession | null) => void } = {};
        const client = { auth: mockAuth(onChange) };
        renderHook(() => useRebaseAuthController({ client }));

        await flush(() => onChange.current!("TOKEN_REFRESHED", null));

        expect(cached("orders", "1")).toBeDefined();
    });
});
