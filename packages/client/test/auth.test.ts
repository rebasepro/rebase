import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { createAuth, createMemoryStorage, createCookieStorage, RebaseSession, AuthChangeEvent } from "../src/auth";
import type { RebaseSession as TypesRebaseSession, User } from "@rebasepro/types";
import { Transport, RebaseApiError } from "../src/transport";

// Compile-time assertions: RebaseSession from client and types are the same type
const _assertSameType1: TypesRebaseSession = {} as RebaseSession;
const _assertSameType2: RebaseSession = {} as TypesRebaseSession;
void _assertSameType1; void _assertSameType2;

/** Minimal mock Response shape used by auth methods that call fetch directly. */
interface MockResponse {
    ok: boolean;
    status?: number;
    statusText?: string;
    json: () => Promise<Record<string, unknown>>;
}

type MockFetch = jest.Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<MockResponse>>;

function createMockTransport(mockFetch?: MockFetch) {
    const mockRequest = jest.fn() as jest.Mock<Transport["request"]>;
    const fetchFn = mockFetch || (jest.fn() as MockFetch);
    const transport: Transport = {
        request: mockRequest,
        baseUrl: "http://localhost",
        apiPath: "/api/v1",
        fetchFn: fetchFn as unknown as typeof globalThis.fetch,
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({}),
        resolveToken: jest.fn().mockResolvedValue(null)
    };
    return { transport,
mockRequest,
mockFetch: fetchFn as MockFetch };
}

const mockUser: User = {
    uid: "usr_1",
    email: "test@example.com",
    displayName: "Test User",
    roles: ["user"],
    photoURL: null,
    providerId: "local",
    isAnonymous: false
};

function mockTokens(expiresAt?: number) {
    return {
        accessToken: "fake-jwt",
        refreshToken: "fake-refresh",
        accessTokenExpiresAt: expiresAt ?? Date.now() + 3600000
    };
}

function mockSessionObj(expiresAt?: number): RebaseSession {
    return {
        accessToken: "fake-jwt",
        refreshToken: "fake-refresh",
        expiresAt: expiresAt ?? Date.now() + 3600000,
        user: mockUser
    };
}

describe("createAuth", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<Transport["request"]>;
    let mockFetch: MockFetch;

    beforeEach(() => {
        jest.useFakeTimers();
        ({ transport, mockRequest, mockFetch } = createMockTransport());
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // Session initialization
    // -----------------------------------------------------------------------
    describe("Session initialization", () => {
        it("initializes without a session if storage is empty", () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            expect(auth.getSession()).toBeNull();
        });

        it("restores session from storage if token is still valid", () => {
            const storage = createMemoryStorage();
            const session = mockSessionObj(Date.now() + 1000000);
            storage.setItem("rebase_auth", JSON.stringify(session));

            const auth = createAuth(transport, { storage });
            expect(auth.getSession()?.accessToken).toBe("fake-jwt");
            expect(transport.setToken).toHaveBeenCalledWith("fake-jwt");
        });

        it("attempts refresh when stored session is expired", async () => {
            const storage = createMemoryStorage();
            const expiredSession = mockSessionObj(Date.now() - 1000);
            storage.setItem("rebase_auth", JSON.stringify(expiredSession));

            const newExpiry = Date.now() + 3600000;
            // Mock the refresh fetch call
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: { ...mockTokens(newExpiry),
accessToken: "refreshed-jwt" }
                })
            });

            const auth = createAuth(transport, { storage });
            await auth.isInitialized();

            // Boot restores the expired session optimistically and fires
            // /refresh underneath it. `getSession()` is nullable, so asserting
            // it "toBeDefined" would also pass on the null the failure path
            // leaves behind — i.e. with no refresh attempted at all. Assert the
            // network call the test is named for.
            expect(mockFetch).toHaveBeenCalledWith(
                "http://localhost/api/v1/auth/refresh",
                expect.objectContaining({ method: "POST" })
            );
            expect(auth.getSession()?.accessToken).toBe("refreshed-jwt");
            expect(auth.getSession()?.expiresAt).toBe(newExpiry);
        });

        it("skips session restore when persistSession is false", () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));

            const auth = createAuth(transport, { storage,
persistSession: false });
            expect(auth.getSession()).toBeNull();
        });

        it("does not restore session with missing/corrupt storage data", () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", "not-valid-json");

            const auth = createAuth(transport, { storage });
            expect(auth.getSession()).toBeNull();
        });

        it("does not restore session without accessToken", () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify({ refreshToken: "rt",
expiresAt: Date.now() + 100000 }));

            const auth = createAuth(transport, { storage });
            expect(auth.getSession()).toBeNull();
        });

        it("resolves isInitialized after restore", async () => {
            const storage = createMemoryStorage();
            const session = mockSessionObj(Date.now() + 1000000);
            storage.setItem("rebase_auth", JSON.stringify(session));

            const auth = createAuth(transport, { storage });
            await expect(auth.isInitialized()).resolves.toBeUndefined();
            // `toBeDefined()` on a `RebaseSession | null` getter is satisfied by
            // null, so it would not notice a restore that silently dropped the
            // session — pin the token that was actually restored.
            expect(auth.getSession()?.accessToken).toBe("fake-jwt");
            expect(auth.getSession()?.expiresAt).toBe(session.expiresAt);
        });

        /**
         * The logged-out flash, pinned.
         *
         * In cookie mode the refresh token is in an HttpOnly cookie the page
         * cannot read, so a restore is *always* a round trip — and
         * `getSession()` is synchronous, so on the first render it answers
         * `null` whether there is a session or not. An app that reads it
         * without awaiting `isInitialized()` renders the signed-out view on
         * every reload, which is what `examples/sdk-demo` did.
         */
        it("has no session to hand out until isInitialized resolves, in cookie mode", async () => {
            const { transport, mockFetch } = createMockTransport();
            let releaseRefresh: (value: MockResponse) => void;
            mockFetch.mockReturnValueOnce(new Promise<MockResponse>((resolve) => {
                releaseRefresh = resolve;
            }));

            const auth = createAuth(transport, {
                storage: createMemoryStorage(),
                authFlowMode: "cookie"
            });

            // Before: nothing, and it is not because there is nothing.
            expect(auth.getSession()).toBeNull();

            releaseRefresh!({
                ok: true,
                json: async () => ({ tokens: mockTokens(Date.now() + 3600000) })
            });
            await auth.isInitialized();

            // After: the session the cookie stood for.
            expect(auth.getSession()?.accessToken).toBe("fake-jwt");
        });

        it("resolves isInitialized after failed restore", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", "invalid-json");

            const auth = createAuth(transport, { storage });
            await expect(auth.isInitialized()).resolves.toBeUndefined();
            expect(auth.getSession()).toBeNull();
        });

        it("resolves isInitialized after background refresh on boot", async () => {
            const storage = createMemoryStorage();
            const expiredSession = mockSessionObj(Date.now() - 1000);
            storage.setItem("rebase_auth", JSON.stringify(expiredSession));

            let resolveFetch: (val: any) => void;
            const fetchPromise = new Promise(resolve => { resolveFetch = resolve; });
            mockFetch.mockReturnValueOnce(fetchPromise as any);

            const auth = createAuth(transport, { storage });
            
            let initialized = false;
            auth.isInitialized().then(() => { initialized = true; });
            
            expect(initialized).toBe(false);
            
            resolveFetch!({
                ok: true,
                json: async () => ({
                    tokens: mockTokens(Date.now() + 3600000),
                    user: mockUser
                })
            });
            await Promise.resolve();
            await Promise.resolve();

            await expect(auth.isInitialized()).resolves.toBeUndefined();
            expect(initialized).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // auto-refresh resilience
    // -----------------------------------------------------------------------
    describe("auto-refresh resilience", () => {
        /*
         * These used to `await Promise.resolve()` eight times and assert.
         *
         * Eight was however many microtasks the refresh path happened to take
         * when they were written; it grew (rotation became concurrency-safe,
         * which added awaits) and the sign-out assertion started failing on a
         * code path that was still correct. The sibling test hid it: "the
         * session is NOT null" passes trivially when nothing has run yet, so
         * the suite reported one failure where it should have reported that
         * both tests had stopped meaning anything.
         *
         * Waiting for the condition instead of for a tick count is what makes
         * this stable. Still no timers and no wall-clock — it drains the
         * microtask queue, so it is as deterministic as the counting was, and
         * a real regression fails it in milliseconds rather than hanging.
         */
        const TICK_BUDGET = 1000;

        /** Drain microtasks until `predicate` holds, or the budget runs out. */
        const settle = async (predicate: () => boolean) => {
            for (let i = 0; i < TICK_BUDGET; i++) {
                if (predicate()) return;
                await Promise.resolve();
            }
        };

        /** Drain the whole budget — for asserting something does NOT happen. */
        const drain = async () => {
            for (let i = 0; i < TICK_BUDGET; i++) await Promise.resolve();
        };

        it("retries instead of signing out on a transient refresh failure (5xx)", async () => {
            const storage = createMemoryStorage();
            // Valid session but within the refresh buffer → schedules an immediate refresh.
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj(Date.now() + 60000)));
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Server Error",
                json: async () => ({ error: { message: "boom", code: "INTERNAL" } })
            });

            const auth = createAuth(transport, { storage });
            await drain();

            // A transient 5xx must NOT drop the session — a retry is scheduled
            // instead. Drained fully, so the refresh has definitely been
            // attempted and its failure handled before this is asserted.
            expect(mockFetch).toHaveBeenCalled();
            expect(auth.getSession()).not.toBeNull();
        });

        it("signs out on a fatal refresh failure (invalid token)", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj(Date.now() + 60000)));
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: async () => ({ error: { message: "bad", code: "INVALID_TOKEN" } })
            });

            const auth = createAuth(transport, { storage });
            await settle(() => auth.getSession() === null);

            expect(auth.getSession()).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // handleUnauthorized — the 401 path taken by ordinary API requests
    // -----------------------------------------------------------------------
    describe("handleUnauthorized", () => {
        it("refreshes and reports retryable", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: {
                        accessToken: "new-jwt",
                        refreshToken: "new-refresh",
                        accessTokenExpiresAt: Date.now() + 3600000
                    }
                })
            });

            await expect(auth.handleUnauthorized()).resolves.toBe(true);
            expect(auth.getSession()?.accessToken).toBe("new-jwt");
        });

        it("signs out when the refresh token itself is rejected", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });
            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: async () => ({ error: { message: "Invalid refresh token", code: "INVALID_TOKEN" } })
            });

            await expect(auth.handleUnauthorized()).resolves.toBe(false);
            expect(auth.getSession()).toBeNull();
            expect(storage.getItem("rebase_auth")).toBeNull();
            expect(listener).toHaveBeenCalledWith("SIGNED_OUT", null);
        });

        it("keeps the session on a transient failure", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });
            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            mockFetch.mockRejectedValueOnce(new Error("Network down"));

            await expect(auth.handleUnauthorized()).resolves.toBe(false);
            expect(auth.getSession()).not.toBeNull();
            expect(listener).not.toHaveBeenCalledWith("SIGNED_OUT", null);
        });

        it("signs out when the session has no refresh token to spend", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify({ ...mockSessionObj(),
refreshToken: "" }));
            const auth = createAuth(transport, { storage });
            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            await expect(auth.handleUnauthorized()).resolves.toBe(false);
            expect(auth.getSession()).toBeNull();
            expect(listener).toHaveBeenCalledWith("SIGNED_OUT", null);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("does not emit SIGNED_OUT for an anonymous caller", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            await expect(auth.handleUnauthorized()).resolves.toBe(false);
            expect(listener).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // signInWithEmail
    // -----------------------------------------------------------------------
    describe("signInWithEmail", () => {
        it("sends credentials and initiates session", async () => {
            const session = mockSessionObj();
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: mockTokens(session.expiresAt),
                    user: mockUser
                })
            });

            const storage = createMemoryStorage();
            const auth = createAuth(transport, { storage });

            const sessionInfo = await auth.signInWithEmail("test@example.com", "password123");

            expect(sessionInfo.accessToken).toEqual(session.accessToken);
            expect(mockFetch).toHaveBeenCalledWith("http://localhost/api/v1/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "test@example.com",
password: "password123" })
            });
            expect(auth.getSession()?.accessToken).toEqual(session.accessToken);
            expect(transport.setToken).toHaveBeenCalledWith(session.accessToken);
        });

        it("throws on failed login", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: async () => ({ error: { message: "Invalid credentials",
code: "INVALID_CREDENTIALS" } })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            await expect(auth.signInWithEmail("bad@email.com", "wrong")).rejects.toThrow("Invalid credentials");
        });

        it("emits SIGNED_IN event", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(),
user: mockUser })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            await auth.signInWithEmail("test@example.com", "pass");
            expect(listener).toHaveBeenCalledWith("SIGNED_IN", expect.objectContaining({ accessToken: "fake-jwt" }));
        });
    });

    // -----------------------------------------------------------------------
    // signUp
    // -----------------------------------------------------------------------
    describe("signUp", () => {
        it("creates a user and initiates session", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(),
user: mockUser })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            const sessionInfo = await auth.signUp("test@example.com", "password123", "Test User");

            expect(sessionInfo.accessToken).toEqual("fake-jwt");
            expect(mockFetch).toHaveBeenCalledWith("http://localhost/api/v1/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "test@example.com",
password: "password123",
displayName: "Test User" })
            });
        });

        it("sends without displayName when not provided", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(),
user: mockUser })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            await auth.signUp("test@example.com", "password123");

            const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
            expect(body.displayName).toBeUndefined();
        });

        it("throws on failed registration", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 409,
                statusText: "Conflict",
                json: async () => ({ error: { message: "Email already exists" } })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            await expect(auth.signUp("existing@email.com", "pass")).rejects.toThrow("Email already exists");
        });
    });

    // -----------------------------------------------------------------------
    // signInWithGoogle
    // -----------------------------------------------------------------------
    describe("signInWithGoogle", () => {
        it("sends Google ID token and initiates session", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(),
user: mockUser })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            const sessionInfo = await auth.signInWithGoogle({ idToken: "google-id-token" });

            expect(sessionInfo.accessToken).toBe("fake-jwt");
            expect(mockFetch).toHaveBeenCalledWith("http://localhost/api/v1/auth/google", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken: "google-id-token" })
            });
        });

        it("throws on Google auth failure", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: async () => ({ error: { message: "Invalid Google token" } })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            await expect(auth.signInWithGoogle({ idToken: "bad-token" })).rejects.toThrow("Invalid Google token");
        });
    });

    // -----------------------------------------------------------------------
    // signOut
    // -----------------------------------------------------------------------
    describe("signOut", () => {
        it("clears session, storage, notifies listeners, calls backend", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));

            const auth = createAuth(transport, { storage });
            expect(auth.getSession()?.accessToken).toEqual("fake-jwt");

            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            mockFetch.mockResolvedValueOnce({ ok: true,
json: async () => ({}) });
            await auth.signOut();

            expect(auth.getSession()).toBeNull();
            expect(storage.getItem("rebase_auth")).toBeNull();
            expect(transport.setToken).toHaveBeenCalledWith(null);
            expect(listener).toHaveBeenCalledWith("SIGNED_OUT", null);
            expect(mockFetch).toHaveBeenCalledWith("http://localhost/api/v1/auth/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken: "fake-refresh" })
            });
        });

        it("handles backend logout failure gracefully", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));

            const auth = createAuth(transport, { storage });
            mockFetch.mockRejectedValueOnce(new Error("Network error"));

            // Should not throw
            await auth.signOut();
            expect(auth.getSession()).toBeNull();
        });

        it("works when no session exists", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            await auth.signOut();
            expect(auth.getSession()).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // refreshSession
    // -----------------------------------------------------------------------
    describe("refreshSession", () => {
        it("refreshes token and updates storage", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: {
                        accessToken: "new-jwt",
                        refreshToken: "new-refresh",
                        accessTokenExpiresAt: Date.now() + 3600000
                    }
                })
            });

            const result = await auth.refreshSession();
            expect(result.accessToken).toEqual("new-jwt");
            expect(transport.setToken).toHaveBeenCalledWith("new-jwt");
        });

        it("throws when no active session to refresh", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            await expect(auth.refreshSession()).rejects.toThrow("No active session to refresh");
        });

        it("emits TOKEN_REFRESHED event", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: {
                        accessToken: "refreshed",
                        refreshToken: "refreshed-rt",
                        accessTokenExpiresAt: Date.now() + 3600000
                    }
                })
            });

            await auth.refreshSession();
            expect(listener).toHaveBeenCalledWith("TOKEN_REFRESHED", expect.objectContaining({ accessToken: "refreshed" }));
        });

        it("preserves user data on refresh", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: {
                        accessToken: "new",
                        refreshToken: "new-rt",
                        accessTokenExpiresAt: Date.now() + 3600000
                    }
                })
            });

            const result = await auth.refreshSession();
            expect(result.user.uid).toBe("usr_1");
        });

        it("populates user from the /refresh response body when present", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    user: {
                        uid: "usr_2",
                        email: "refreshed@example.com",
                        displayName: "Refreshed User",
                        roles: ["admin"]
                    },
                    tokens: {
                        accessToken: "new",
                        refreshToken: "new-rt",
                        accessTokenExpiresAt: Date.now() + 3600000
                    }
                })
            });

            const result = await auth.refreshSession();
            // The response body's user wins over the stale in-memory user (usr_1)
            expect(result.user.uid).toBe("usr_2");
            expect(result.user.email).toBe("refreshed@example.com");
            expect(result.user.roles).toEqual(["admin"]);
        });

        it("falls back to /me when refresh returns no user and none is in memory", async () => {
            // Simulate a cold start restored from an httpOnly cookie: a valid
            // session token but a blank user object, and a /refresh response
            // that (older backend) does not echo the user.
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify({
                accessToken: "fake-jwt",
                refreshToken: "fake-refresh",
                expiresAt: Date.now() + 3600000,
                user: { uid: "", email: null, displayName: null, photoURL: null, providerId: "password", isAnonymous: false }
            }));
            const auth = createAuth(transport, { storage });

            // /me returns the real user
            mockRequest.mockResolvedValueOnce({ user: mockUser } as never);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: {
                        accessToken: "new",
                        refreshToken: "new-rt",
                        accessTokenExpiresAt: Date.now() + 3600000
                    }
                })
            });

            const result = await auth.refreshSession();
            expect(mockRequest).toHaveBeenCalledWith("/auth/me", expect.objectContaining({ method: "GET" }));
            expect(result.user.uid).toBe("usr_1");
        });

        it("throws on refresh failure", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: async () => ({ error: { message: "Refresh token expired" } })
            });

            await expect(auth.refreshSession()).rejects.toThrow("Refresh token expired");
        });

        it("de-dupes concurrent refreshes into a single request", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            // Only one refresh response is queued — if the two concurrent calls
            // each hit the network, the second would find no mock and fail.
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: { accessToken: "x", refreshToken: "y", accessTokenExpiresAt: Date.now() + 3600000 }
                })
            });

            const [a, b] = await Promise.all([auth.refreshSession(), auth.refreshSession()]);

            const refreshCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes("/refresh")).length;
            expect(refreshCalls).toBe(1);
            expect(a).toBe(b); // both callers share the one in-flight result
        });
    });

    // -----------------------------------------------------------------------
    // User management
    // -----------------------------------------------------------------------
    describe("User management", () => {
        it("getUser calls transport /auth/me", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ user: mockUser });

            const user = await auth.getUser();
            expect(user).toEqual(mockUser);
            expect(mockRequest).toHaveBeenCalledWith("/auth/me", { method: "GET" });
        });

        it("updateUser updates session and emits USER_UPDATED", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            const updatedUser = { ...mockUser,
displayName: "New Name" };
            mockRequest.mockResolvedValueOnce({ user: updatedUser });

            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            const result = await auth.updateUser({ displayName: "New Name" });
            expect(result.displayName).toBe("New Name");
            expect(listener).toHaveBeenCalledWith("USER_UPDATED", expect.objectContaining({
                user: expect.objectContaining({ displayName: "New Name" })
            }));
            expect(mockRequest).toHaveBeenCalledWith("/auth/me", {
                method: "PATCH",
                body: JSON.stringify({ displayName: "New Name" })
            });
        });

        it("updateUser does not emit event when no active session", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            const updatedUser = { ...mockUser,
displayName: "New Name" };
            mockRequest.mockResolvedValueOnce({ user: updatedUser });

            const listener = jest.fn();
            auth.onAuthStateChange(listener);

            await auth.updateUser({ displayName: "New Name" });
            expect(listener).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Password management
    // -----------------------------------------------------------------------
    describe("Password management", () => {
        it("resetPasswordForEmail sends email", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true,
message: "Reset email sent" })
            });

            const result = await auth.resetPasswordForEmail("user@test.com");
            expect(result.success).toBe(true);
            expect(mockFetch).toHaveBeenCalledWith("http://localhost/api/v1/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user@test.com" })
            });
        });

        it("resetPassword resets with token", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true,
message: "Password reset" })
            });

            const result = await auth.resetPassword("reset-token-123", "newPass");
            expect(result.success).toBe(true);
            expect(mockFetch).toHaveBeenCalledWith("http://localhost/api/v1/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: "reset-token-123",
password: "newPass" })
            });
        });

        it("changePassword calls transport", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ success: true,
message: "Changed" });

            const result = await auth.changePassword("oldPass", "newPass");
            expect(result.success).toBe(true);
            expect(mockRequest).toHaveBeenCalledWith("/auth/change-password", {
                method: "POST",
                body: JSON.stringify({ oldPassword: "oldPass",
newPassword: "newPass" })
            });
        });
    });

    // -----------------------------------------------------------------------
    // Email verification
    // -----------------------------------------------------------------------
    describe("Email verification", () => {
        it("sendVerificationEmail calls transport", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ success: true,
message: "Sent" });

            const result = await auth.sendVerificationEmail();
            expect(result.success).toBe(true);
            expect(mockRequest).toHaveBeenCalledWith("/auth/send-verification", { method: "POST" });
        });

        it("verifyEmail makes GET request with token", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true,
message: "Verified" })
            });

            const result = await auth.verifyEmail("verification-token");
            expect(result.success).toBe(true);
            expect(mockFetch).toHaveBeenCalledWith(
                "http://localhost/api/v1/auth/verify-email?token=verification-token",
                expect.objectContaining({ method: "GET" })
            );
        });

        it("verifyEmail URL-encodes the token", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true,
message: "Verified" })
            });

            await auth.verifyEmail("token with spaces&special=chars");
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining("token%20with%20spaces%26special%3Dchars"),
                expect.any(Object)
            );
        });
    });

    /**
     * The backend has served `/auth/anonymous` and `/auth/mfa/*` since they
     * landed; the SDK exposed neither, so an app that wanted either hand-wrote
     * `fetch` calls — the auth header, the cookie flag, the session adoption —
     * which is the whole job of a client.
     */
    describe("Anonymous sessions", () => {
        it("signInAnonymously adopts the session it is handed", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(), user: { ...mockUser, isAnonymous: true } })
            });

            const result = await auth.signInAnonymously();

            expect(mockFetch).toHaveBeenCalledWith(
                "http://localhost/api/v1/auth/anonymous",
                expect.objectContaining({ method: "POST" })
            );
            expect(result.user.uid).toBe("usr_1");
            // Adopted, not merely returned: the next request carries the token.
            expect(auth.getSession()?.accessToken).toBe("fake-jwt");
        });

        it("linkAnonymous keeps the id and re-adopts the upgraded session", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({
                tokens: mockTokens(),
                user: { ...mockUser, isAnonymous: false }
            });

            const result = await auth.linkAnonymous("user@example.com", "pw");

            expect(mockRequest).toHaveBeenCalledWith("/auth/anonymous/link", expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ email: "user@example.com", password: "pw" })
            }));
            expect(result.user.uid).toBe("usr_1");
            expect(auth.getSession()?.accessToken).toBe("fake-jwt");
        });
    });

    describe("MFA", () => {
        it("enroll posts to /auth/mfa/enroll and returns the secret and recovery codes", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({
                factor: { id: "f1", factorType: "totp" },
                totp: { secret: "S", uri: "otpauth://x", qrUri: "otpauth://x" },
                recoveryCodes: ["a", "b"]
            });

            const result = await auth.mfa.enroll({ friendlyName: "Phone" });

            expect(mockRequest).toHaveBeenCalledWith("/auth/mfa/enroll", expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ friendlyName: "Phone" })
            }));
            expect(result.recoveryCodes).toEqual(["a", "b"]);
        });

        it("listFactors unwraps the envelope", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ factors: [{ id: "f1", factorType: "totp", verified: true }] });

            const factors = await auth.mfa.listFactors();

            expect(mockRequest).toHaveBeenCalledWith("/auth/mfa/factors", { method: "GET" });
            expect(factors).toHaveLength(1);
        });

        it("unenroll uses DELETE, which is the method the route answers to", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ success: true, message: "removed" });

            await auth.mfa.unenroll("f1");

            expect(mockRequest).toHaveBeenCalledWith("/auth/mfa/unenroll", expect.objectContaining({
                method: "DELETE"
            }));
        });

        it("verifyChallenge adopts the aal2 session it mints", async () => {
            // The whole point of the challenge: the tokens it returns replace
            // the aal1 ones the sign-in handed back.
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ tokens: mockTokens(), user: mockUser });

            const result = await auth.mfa.verifyChallenge("ch1", "418293");

            expect(mockRequest).toHaveBeenCalledWith("/auth/mfa/challenge/verify", expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ challengeId: "ch1", code: "418293" })
            }));
            expect(result.user.uid).toBe("usr_1");
            expect(auth.getSession()?.accessToken).toBe("fake-jwt");
        });
    });

    // -----------------------------------------------------------------------
    // Session management
    // -----------------------------------------------------------------------
    describe("Session management", () => {
        it("getSessions calls /auth/sessions", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ sessions: [{ id: "s1" }] });

            const sessions = await auth.getSessions();
            expect(sessions).toEqual([{ id: "s1" }]);
            expect(mockRequest).toHaveBeenCalledWith("/auth/sessions", { method: "GET" });
        });

        it("revokeSession calls DELETE /auth/sessions/:id", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ success: true });

            await auth.revokeSession("sess_1");
            expect(mockRequest).toHaveBeenCalledWith("/auth/sessions/sess_1", { method: "DELETE" });
        });

        it("revokeSession encodes the session id", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockRequest.mockResolvedValueOnce({ success: true });

            await auth.revokeSession("sess/with/slashes");
            expect(mockRequest).toHaveBeenCalledWith("/auth/sessions/sess%2Fwith%2Fslashes", { method: "DELETE" });
        });

        it("revokeAllSessions clears local state and emits SIGNED_OUT", async () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify(mockSessionObj()));
            const auth = createAuth(transport, { storage });

            const listener = jest.fn();
            auth.onAuthStateChange(listener);
            mockRequest.mockResolvedValueOnce({ success: true });

            await auth.revokeAllSessions();
            expect(auth.getSession()).toBeNull();
            expect(storage.getItem("rebase_auth")).toBeNull();
            expect(transport.setToken).toHaveBeenCalledWith(null);
            expect(listener).toHaveBeenCalledWith("SIGNED_OUT", null);
        });
    });

    // -----------------------------------------------------------------------
    // Auth config
    // -----------------------------------------------------------------------
    describe("getAuthConfig", () => {
        it("fetches auth configuration", async () => {
            const auth = createAuth(transport, { storage: createMemoryStorage() });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    needsSetup: false,
                    registrationEnabled: true,
                    emailServiceEnabled: true,
                    enabledProviders: ["google"]
                })
            });

            const config = await auth.getAuthConfig();
            expect(config.registrationEnabled).toBe(true);
            expect(config.enabledProviders).toContain("google");
            expect(mockFetch).toHaveBeenCalledWith("http://localhost/api/v1/auth/config", {
                method: "GET",
                headers: { "Content-Type": "application/json" }
            });
        });
    });

    // -----------------------------------------------------------------------
    // onAuthStateChange
    // -----------------------------------------------------------------------
    describe("onAuthStateChange", () => {
        it("returns an unsubscribe function that removes the listener", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(),
user: mockUser })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            const listener = jest.fn();
            const unsubscribe = auth.onAuthStateChange(listener);

            await auth.signInWithEmail("test@example.com", "pass");
            expect(listener).toHaveBeenCalledTimes(1);

            // Unsubscribe
            unsubscribe();

            // Log out should NOT call the listener again
            mockFetch.mockResolvedValueOnce({ ok: true,
json: async () => ({}) });
            await auth.signOut();
            expect(listener).toHaveBeenCalledTimes(1); // Still 1
        });

        it("supports multiple listeners", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(),
user: mockUser })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            const listener1 = jest.fn();
            const listener2 = jest.fn();
            auth.onAuthStateChange(listener1);
            auth.onAuthStateChange(listener2);

            await auth.signInWithEmail("test@example.com", "pass");
            expect(listener1).toHaveBeenCalledTimes(1);
            expect(listener2).toHaveBeenCalledTimes(1);
        });

        it("catches errors in listeners and does not propagate", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(),
user: mockUser })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage() });
            const badListener = jest.fn().mockImplementation(() => { throw new Error("listener error"); });
            const goodListener = jest.fn();

            auth.onAuthStateChange(badListener);
            auth.onAuthStateChange(goodListener);

            await auth.signInWithEmail("test@example.com", "pass"); // Should not throw
            expect(goodListener).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Auto-refresh scheduling
    // -----------------------------------------------------------------------
    describe("Auto-refresh scheduling", () => {
        it("schedules a refresh before token expiry", async () => {
            const expiresAt = Date.now() + 300000; // 5 minutes from now
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: mockTokens(expiresAt),
                    user: mockUser
                })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage(),
autoRefresh: true });
            await auth.signInWithEmail("test@example.com", "pass");

            // The refresh should be scheduled. Mock the refresh call.
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: { ...mockTokens(Date.now() + 3600000),
accessToken: "refreshed-jwt" }
                })
            });

            // The refresh is armed for REFRESH_BUFFER_MS (2 min) *before*
            // expiry, not at expiry — a timer that only fires once the token is
            // already dead is the bug this pins. One tick short of the buffer
            // boundary nothing may have gone out yet.
            expect(jest.getTimerCount()).toBe(1);
            await jest.advanceTimersByTimeAsync(300000 - 120000 - 1);
            expect(mockFetch).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(1);
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenLastCalledWith(
                "http://localhost/api/v1/auth/refresh",
                expect.objectContaining({ method: "POST" })
            );
            expect(auth.getSession()?.accessToken).toBe("refreshed-jwt");
        });

        it("disables auto-refresh when autoRefresh option is false", async () => {
            const expiresAt = Date.now() + 300000;
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tokens: mockTokens(expiresAt),
                    user: mockUser
                })
            });

            const auth = createAuth(transport, { storage: createMemoryStorage(),
autoRefresh: false });
            await auth.signInWithEmail("test@example.com", "pass");

            // Advance past expiry - should not try to refresh
            jest.advanceTimersByTime(400000);
            // Only the initial sign-in fetch call
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    // -----------------------------------------------------------------------
    // Custom authPath
    // -----------------------------------------------------------------------
    describe("Custom authPath", () => {
        it("uses custom authPath for all auth endpoints", async () => {
            const auth = createAuth(transport, {
                storage: createMemoryStorage(),
                authPath: "/custom-auth"
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tokens: mockTokens(),
user: mockUser })
            });

            await auth.signInWithEmail("test@example.com", "pass");
            expect(mockFetch).toHaveBeenCalledWith(
                "http://localhost/api/v1/custom-auth/login",
                expect.any(Object)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Memory storage
    // -----------------------------------------------------------------------
    describe("MemoryStorage", () => {
        it("stores and retrieves values", () => {
            const storage = createMemoryStorage();
            storage.setItem("key", "val");
            expect(storage.getItem("key")).toBe("val");
            storage.removeItem("key");
            expect(storage.getItem("key")).toBeNull();
        });

        it("returns null for non-existent keys", () => {
            const storage = createMemoryStorage();
            expect(storage.getItem("nonexistent")).toBeNull();
        });

        it("overwrites existing values", () => {
            const storage = createMemoryStorage();
            storage.setItem("key", "old");
            storage.setItem("key", "new");
            expect(storage.getItem("key")).toBe("new");
        });
    });

    // -----------------------------------------------------------------------
    // Cookie storage
    // -----------------------------------------------------------------------
    describe("CookieStorage", () => {
        let originalDocument: any;

        beforeEach(() => {
            originalDocument = (globalThis as any).document;
            const mockDoc = {
                _cookie: "",
                get cookie() {
                    return this._cookie;
                },
                set cookie(val) {
                    const parts = val.split(";");
                    const pair = parts[0].trim();
                    const key = pair.split("=")[0];
                    const value = pair.substring(key.length + 1);

                    const isDelete = parts.some(p => p.trim().startsWith("max-age=-1"));

                    const cookies = this._cookie ? this._cookie.split(";").map(c => c.trim()) : [];
                    const filtered = cookies.filter(c => !c.startsWith(key + "="));

                    if (!isDelete) {
                        filtered.push(`${key}=${value}`);
                    }
                    this._cookie = filtered.join("; ");
                }
            };
            (globalThis as any).document = mockDoc as any;
        });

        afterEach(() => {
            (globalThis as any).document = originalDocument;
        });

        it("stores and retrieves values using document.cookie", () => {
            const storage = createCookieStorage();
            storage.setItem("key", "val");
            expect(storage.getItem("key")).toBe("val");
            storage.removeItem("key");
            expect(storage.getItem("key")).toBeNull();
        });

        it("returns null for non-existent keys", () => {
            const storage = createCookieStorage();
            expect(storage.getItem("nonexistent")).toBeNull();
        });

        it("overwrites existing values", () => {
            const storage = createCookieStorage();
            storage.setItem("key", "old");
            storage.setItem("key", "new");
            expect(storage.getItem("key")).toBe("new");
        });
    });
});
