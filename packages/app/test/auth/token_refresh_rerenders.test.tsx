/**
 * A token refresh for the same user re-renders nothing.
 *
 * The SDK refreshes the access token about once an hour (and a few auth
 * events land at boot), each time handing over a freshly mapped user — the
 * same person, field for field, in a new object. The auth controller took
 * that object as a change, and was itself a new object on every render; and
 * `<Rebase>` defaulted `slots` to a fresh `[]`, rebuilding the customization
 * controller on every render. So every refresh changed `useRebaseContext()`
 * for every consumer: all mounted views re-rendered, effects keyed on the
 * context re-ran (an additional field's `value()` per visible row), and the
 * storage sources were fetched again.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import type { AuthChangeEvent, RebaseClient, RebaseSession } from "@rebasepro/types";
import { Rebase } from "../../src/core/Rebase";
import { useRebaseAuthController } from "../../src/auth/useRebaseAuthController";
import { useRebaseContext } from "../../src/hooks";

const user = {
    uid: "u1",
    email: "ada@rebase.pro",
    displayName: "Ada",
    photoURL: null,
    providerId: "password",
    isAnonymous: false,
    emailVerified: true,
    roles: ["editor"],
    metadata: { team: "core" }
};

function sessionFor(u: typeof user, token: string): RebaseSession {
    return {
        accessToken: token,
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600_000,
        user: u
    } as RebaseSession;
}

let emit: (event: AuthChangeEvent, session: RebaseSession | null) => void = () => undefined;

function fakeClient() {
    const auth = {
        getSession: jest.fn(() => sessionFor(user, "t0")),
        isInitialized: jest.fn(() => Promise.resolve()),
        getAuthConfig: jest.fn(() => Promise.resolve({ needsSetup: false, registrationEnabled: false, storage: true })),
        onAuthStateChange: jest.fn((listener: typeof emit) => {
            emit = listener;
            return () => undefined;
        })
    };
    return {
        baseUrl: "https://api.test",
        auth,
        data: { collection: () => ({}) },
        fetchStorageSources: jest.fn(() => Promise.resolve([]))
    } as unknown as RebaseClient & { fetchStorageSources: jest.Mock };
}

let consumerRenders = 0;

/** A view below the shell: re-renders only when the context it reads changes. */
const Consumer = React.memo(function Consumer() {
    useRebaseContext();
    consumerRenders++;
    return null;
});

const consumer = <Consumer/>;
const storageSource = {} as never;

function App({ client, tick }: { client: RebaseClient, tick: number }) {
    void tick;
    const authController = useRebaseAuthController({ client });
    return (
        <Rebase authController={authController} client={client} storageSource={storageSource}>
            {consumer}
        </Rebase>
    );
}

const settle = () => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("auth changes and the context consumers", () => {

    let client: ReturnType<typeof fakeClient>;

    beforeEach(async () => {
        client = fakeClient();
        consumerRenders = 0;
    });

    it("a token refresh for the same user re-renders no consumer and refetches nothing", async () => {
        render(<App client={client} tick={0}/>);
        await settle();
        consumerRenders = 0;
        client.fetchStorageSources.mockClear();

        act(() => {
            emit("TOKEN_REFRESHED", sessionFor({ ...user, roles: [...user.roles], metadata: { ...user.metadata } }, "t1"));
        });
        await settle();

        expect(consumerRenders).toBe(0);
        expect(client.fetchStorageSources).not.toHaveBeenCalled();
    });

    it("a token refresh that changes the user still reaches the consumers", async () => {
        render(<App client={client} tick={0}/>);
        await settle();
        consumerRenders = 0;

        act(() => {
            emit("TOKEN_REFRESHED", sessionFor({ ...user, roles: ["admin"] }, "t1"));
        });
        await settle();

        expect(consumerRenders).toBeGreaterThan(0);
    });

    it("the app re-rendering for its own reasons re-renders no consumer", async () => {
        const { rerender } = render(<App client={client} tick={0}/>);
        await settle();
        consumerRenders = 0;

        rerender(<App client={client} tick={1}/>);
        await settle();

        expect(consumerRenders).toBe(0);
    });

    // `<Rebase client>` with no `authController` subscribes to `client.auth` itself.
    it("without an authController prop, a token refresh for the same user re-renders no consumer", async () => {
        render(<Rebase client={client} storageSource={storageSource}>{consumer}</Rebase>);
        await settle();
        consumerRenders = 0;

        act(() => {
            emit("TOKEN_REFRESHED", sessionFor({ ...user, roles: [...user.roles] }, "t1"));
        });
        await settle();

        expect(consumerRenders).toBe(0);
    });

    it("a profile edit for the same user does not refetch the storage sources", async () => {
        render(<App client={client} tick={0}/>);
        await settle();
        client.fetchStorageSources.mockClear();

        act(() => {
            emit("USER_UPDATED", sessionFor({ ...user, displayName: "Ada L." }, "t0"));
        });
        await settle();

        expect(client.fetchStorageSources).not.toHaveBeenCalled();
    });
});
