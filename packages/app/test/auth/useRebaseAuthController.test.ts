import { renderHook, act } from "@testing-library/react";
import { useRebaseAuthController } from "../../src/auth/useRebaseAuthController";
import type { ClientAuth } from "../../src/auth/types";

/**
 * Creates a fully-mocked ClientAuth that satisfies the structural interface.
 * Every method is a jest.fn() so individual tests can override behavior.
 */
function createMockAuth(): jest.Mocked<ClientAuth> {
    return {
        getSession: jest.fn().mockReturnValue(null),
        onAuthStateChange: jest.fn(() => jest.fn()),
        isInitialized: jest.fn().mockResolvedValue(undefined),
        getAuthConfig: jest.fn().mockResolvedValue({
            needsSetup: false,
            registrationEnabled: true,
            enabledProviders: ["google"]
        }),
        signInWithEmail: jest.fn().mockResolvedValue(undefined),
        signOut: jest.fn().mockResolvedValue(undefined),
        refreshSession: jest.fn(),
        updateUser: jest.fn(),
        signUp: jest.fn().mockResolvedValue(undefined),
        signInWithGoogle: jest.fn().mockResolvedValue(undefined),
        signInWithOAuth: jest.fn().mockResolvedValue(undefined),
        resetPasswordForEmail: jest.fn().mockResolvedValue(undefined),
        resetPassword: jest.fn().mockResolvedValue(undefined),
        changePassword: jest.fn().mockResolvedValue(undefined),
        getSessions: jest.fn().mockResolvedValue([]),
        revokeSession: jest.fn().mockResolvedValue(undefined),
        revokeAllSessions: jest.fn().mockResolvedValue(undefined),
    };
}

const mockUser = {
    uid: "123",
    email: "test@rebase.pro",
    displayName: "Test User",
    photoURL: null,
    providerId: "password",
    isAnonymous: false,
    roles: [] as string[]
};

const mockSession = {
    accessToken: "access_token_123",
    refreshToken: "refresh_token_123",
    expiresAt: Date.now() + 3600 * 1000,
    user: mockUser
};

describe("useRebaseAuthController hook (Unified Auth)", () => {
    let mockAuth: jest.Mocked<ClientAuth>;
    let mockClient: {
        baseUrl: string;
        auth: jest.Mocked<ClientAuth>;
        setAuthTokenGetter: jest.Mock;
    };

    beforeEach(() => {
        jest.useFakeTimers();
        mockAuth = createMockAuth();
        mockClient = {
            baseUrl: "https://api.test.rebase.pro",
            auth: mockAuth,
            setAuthTokenGetter: jest.fn(),
        };
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    // ─── Initialization ──────────────────────────────────────────────

    describe("Initialization", () => {
        it("should mount in initial loading state and resolve after SDK initializes", async () => {
            let resolveInit!: () => void;
            const initPromise = new Promise<void>(resolve => { resolveInit = resolve; });
            mockAuth.isInitialized.mockReturnValue(initPromise);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            expect(result.current.initialLoading).toBe(true);
            expect(result.current.user).toBeNull();

            await act(async () => {
                resolveInit();
                await Promise.resolve();
            });

            expect(result.current.initialLoading).toBe(false);
        });

        it("should sync with existing SDK session on mount", async () => {
            mockAuth.getSession.mockReturnValue(mockSession);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await Promise.resolve();
            });

            expect(result.current.initialLoading).toBe(false);
            expect(result.current.user?.uid).toBe("123");
            expect(result.current.user?.displayName).toBe("Test User");
        });

        it("should set initialLoading false when no client/auth is provided", async () => {
            const { result } = renderHook(() => useRebaseAuthController({}));

            // No auth → immediately not loading
            expect(result.current.initialLoading).toBe(false);
            expect(result.current.user).toBeNull();
        });

        it("should set initialLoading false even if isInitialized rejects", async () => {
            mockAuth.isInitialized.mockRejectedValue(new Error("init failed"));

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(result.current.initialLoading).toBe(false);
        });
    });

    // ─── State Sync via onAuthStateChange ────────────────────────────

    describe("State sync via onAuthStateChange", () => {
        it("should update user state when SIGNED_IN fires", async () => {
            let authListener!: (event: string, session: unknown) => void;
            mockAuth.onAuthStateChange.mockImplementation((cb) => {
                authListener = cb;
                return jest.fn();
            });

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => { await Promise.resolve(); });

            expect(result.current.user).toBeNull();

            await act(async () => {
                authListener("SIGNED_IN", mockSession);
                await Promise.resolve();
            });

            expect(result.current.user?.uid).toBe("123");
            expect(result.current.user?.displayName).toBe("Test User");
        });

        it("should clear user state when SIGNED_OUT fires", async () => {
            mockAuth.getSession.mockReturnValue(mockSession);
            let authListener!: (event: string, session: unknown) => void;
            mockAuth.onAuthStateChange.mockImplementation((cb) => {
                authListener = cb;
                return jest.fn();
            });

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => { await Promise.resolve(); });
            expect(result.current.user?.uid).toBe("123");

            await act(async () => {
                authListener("SIGNED_OUT", null);
                await Promise.resolve();
            });

            expect(result.current.user).toBeNull();
            expect(result.current.loginSkipped).toBe(false);
        });

        it("should call onSignOut callback when SIGNED_OUT fires", async () => {
            const onSignOut = jest.fn();
            let authListener!: (event: string, session: unknown) => void;
            mockAuth.onAuthStateChange.mockImplementation((cb) => {
                authListener = cb;
                return jest.fn();
            });

            renderHook(() => useRebaseAuthController({ client: mockClient, onSignOut }));

            await act(async () => { await Promise.resolve(); });

            await act(async () => {
                authListener("SIGNED_OUT", null);
                await Promise.resolve();
            });

            expect(onSignOut).toHaveBeenCalledTimes(1);
        });

        it("should unsubscribe from onAuthStateChange on unmount", async () => {
            const unsubscribe = jest.fn();
            mockAuth.onAuthStateChange.mockReturnValue(unsubscribe);

            const { unmount } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => { await Promise.resolve(); });

            unmount();
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });

    // ─── Auth config ─────────────────────────────────────────────────

    describe("auth config", () => {
        /**
         * `/auth/config` was read once per mount, so `needsSetup` stayed true
         * after the first admin had been created. Signing out in the same tab
         * then showed the bootstrap "create your admin account" form and no way
         * to sign in, until a reload.
         */
        it("reads the backend's config again when the user signs in or out", async () => {
            let authListener!: (event: string, session: unknown) => void;
            mockAuth.onAuthStateChange.mockImplementation((cb) => {
                authListener = cb;
                return jest.fn();
            });
            const config = { needsSetup: true, registrationEnabled: true, enabledProviders: [] as string[] };
            mockAuth.getAuthConfig.mockImplementation(async () => ({ ...config }));

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));
            await act(async () => { await Promise.resolve(); });
            expect(result.current.needsSetup).toBe(true);

            // The bootstrap form creates the first admin, who is signed in.
            config.needsSetup = false;
            await act(async () => {
                authListener("SIGNED_IN", mockSession);
                await Promise.resolve();
            });
            await act(async () => {
                authListener("SIGNED_OUT", null);
                await Promise.resolve();
            });

            expect(result.current.needsSetup).toBe(false);
        });

        it("does not ask again on a token refresh", async () => {
            let authListener!: (event: string, session: unknown) => void;
            mockAuth.onAuthStateChange.mockImplementation((cb) => {
                authListener = cb;
                return jest.fn();
            });

            renderHook(() => useRebaseAuthController({ client: mockClient }));
            await act(async () => { await Promise.resolve(); });
            await act(async () => {
                authListener("TOKEN_REFRESHED", mockSession);
                await Promise.resolve();
            });

            expect(mockAuth.getAuthConfig).toHaveBeenCalledTimes(1);
        });
    });

    // ─── defineRolesFor ──────────────────────────────────────────────

    describe("defineRolesFor", () => {
        it("should apply custom roles to the user state", async () => {
            mockAuth.getSession.mockReturnValue(mockSession);
            const defineRolesFor = jest.fn().mockResolvedValue(["admin", "editor"]);

            const { result } = renderHook(() => useRebaseAuthController({
                client: mockClient,
                defineRolesFor
            }));

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(defineRolesFor).toHaveBeenCalledWith(expect.objectContaining({ uid: "123" }));
            expect(result.current.user?.roles).toEqual(["admin", "editor"]);
        });

        /**
         * `defineRolesFor` is usually a fetch, so the user it was asked about
         * can be gone by the time it answers. The answer used to be applied
         * anyway: a sign-out that landed while roles were in flight was undone
         * when they resolved, leaving the admin rendered as a signed-in admin
         * with no session in the SDK — and nothing left to emit SIGNED_OUT.
         */
        it("does not bring back a user who signed out while their roles were resolving", async () => {
            mockAuth.getSession.mockReturnValue(mockSession);
            mockAuth.isInitialized.mockReturnValue(new Promise(() => undefined));
            let authListener!: (event: string, session: unknown) => void;
            mockAuth.onAuthStateChange.mockImplementation((cb) => {
                authListener = cb;
                return jest.fn();
            });
            let resolveRoles!: (roles: string[]) => void;
            const defineRolesFor = jest.fn(() => new Promise<string[]>(resolve => { resolveRoles = resolve; }));

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient, defineRolesFor }));

            await act(async () => {
                authListener("SIGNED_OUT", null);
                await Promise.resolve();
            });
            expect(result.current.user).toBeNull();

            await act(async () => {
                resolveRoles(["admin"]);
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(result.current.user).toBeNull();
        });

        it("applies the roles of the latest user when an earlier user's resolve finishes last", async () => {
            let authListener!: (event: string, session: unknown) => void;
            mockAuth.onAuthStateChange.mockImplementation((cb) => {
                authListener = cb;
                return jest.fn();
            });
            const pending = new Map<string, (roles: string[]) => void>();
            const defineRolesFor = jest.fn((user: { uid: string }) =>
                new Promise<string[]>(resolve => { pending.set(user.uid, resolve); }));

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient, defineRolesFor }));
            await act(async () => { await Promise.resolve(); });

            await act(async () => {
                authListener("SIGNED_IN", mockSession);
                authListener("SIGNED_IN", { ...mockSession, user: { ...mockUser, uid: "456" } });
                await Promise.resolve();
            });
            await act(async () => {
                pending.get("456")!(["viewer"]);
                await Promise.resolve();
            });
            await act(async () => {
                pending.get("123")!(["admin"]);
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(result.current.user?.uid).toBe("456");
            expect(result.current.user?.roles).toEqual(["viewer"]);
        });
    });

    // ─── Delegation to SDK ───────────────────────────────────────────

    describe("Delegation to SDK", () => {
        it("should delegate emailPasswordLogin to auth.signInWithEmail", async () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.emailPasswordLogin("test@rebase.pro", "password123");
            });

            expect(mockAuth.signInWithEmail).toHaveBeenCalledWith("test@rebase.pro", "password123");
        });

        it("should delegate signOut to auth.signOut", async () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.signOut();
            });

            expect(mockAuth.signOut).toHaveBeenCalled();
        });

        it("should delegate register to auth.signUp", async () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.register("new@user.com", "pass123", "New User");
            });

            expect(mockAuth.signUp).toHaveBeenCalledWith("new@user.com", "pass123", "New User");
        });

        it("should delegate googleLogin to auth.signInWithGoogle", async () => {
            const payload = { idToken: "google-id-token" } as const;
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.googleLogin(payload);
            });

            expect(mockAuth.signInWithGoogle).toHaveBeenCalledWith(payload);
        });

        it("should delegate oauthLogin to auth.signInWithOAuth", async () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.oauthLogin("github", { code: "abc" });
            });

            expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith("github", { code: "abc" });
        });

        it("should delegate updateProfile to auth.updateUser and return result", async () => {
            const updatedUser = { ...mockUser, displayName: "New Name" };
            mockAuth.updateUser.mockResolvedValue(updatedUser);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            let returnedUser;
            await act(async () => {
                returnedUser = await result.current.updateProfile("New Name", "http://photo.jpg");
            });

            expect(mockAuth.updateUser).toHaveBeenCalledWith({
                displayName: "New Name",
                photoURL: "http://photo.jpg"
            });
            expect(returnedUser).toEqual(updatedUser);
        });

        it("should delegate forgotPassword to auth.resetPasswordForEmail", async () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.forgotPassword("user@example.com");
            });

            expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com");
        });

        it("should delegate resetPassword to auth.resetPassword", async () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.resetPassword("reset-token-123", "new-password");
            });

            expect(mockAuth.resetPassword).toHaveBeenCalledWith("reset-token-123", "new-password");
        });

        it("should delegate fetchSessions to auth.getSessions", async () => {
            const sessions = [{ id: "sess-1", current: true }];
            mockAuth.getSessions.mockResolvedValue(sessions as never);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            let returned;
            await act(async () => {
                returned = await result.current.fetchSessions();
            });

            expect(mockAuth.getSessions).toHaveBeenCalled();
            expect(returned).toEqual(sessions);
        });

        it("should delegate revokeSession to auth.revokeSession", async () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.revokeSession("sess-1");
            });

            expect(mockAuth.revokeSession).toHaveBeenCalledWith("sess-1");
        });

        it("should delegate revokeAllSessions to auth.revokeAllSessions", async () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.revokeAllSessions();
            });

            expect(mockAuth.revokeAllSessions).toHaveBeenCalled();
        });
    });

    // ─── Error handling ──────────────────────────────────────────────

    describe("Error handling", () => {
        it("should set authProviderError when emailPasswordLogin fails", async () => {
            const loginError = new Error("Invalid credentials");
            mockAuth.signInWithEmail.mockRejectedValue(loginError);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await expect(result.current.emailPasswordLogin("bad@email.com", "wrong"))
                    .rejects.toThrow("Invalid credentials");
            });

            expect(result.current.authProviderError).toBe(loginError);
            expect(result.current.authLoading).toBe(false);
        });

        it("should set authProviderError when signOut fails", async () => {
            mockAuth.signOut.mockRejectedValue(new Error("network error"));

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                await result.current.signOut();
            });

            expect(result.current.authProviderError).toBeInstanceOf(Error);
            expect(result.current.authLoading).toBe(false);
        });

        it("should clear authProviderError via clearError", async () => {
            const loginError = new Error("fail");
            mockAuth.signInWithEmail.mockRejectedValue(loginError);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                try { await result.current.emailPasswordLogin("x", "y"); } catch { /* expected */ }
            });

            expect(result.current.authProviderError).toBe(loginError);

            act(() => {
                result.current.clearError();
            });

            expect(result.current.authProviderError).toBeNull();
        });
    });

    // ─── MFA second step ─────────────────────────────────────────────

    /**
     * A sign-in by an account with a second factor is refused with
     * `MFA_REQUIRED`, carrying a pending token; the session comes from a
     * challenge opened and answered with that token. The admin had no way to
     * do either, so every account that enrolled TOTP was locked out of it.
     */
    describe("MFA second step", () => {
        const mfaRequired = Object.assign(new Error("Multi-factor authentication is required to complete sign-in."), {
            code: "MFA_REQUIRED",
            details: { mfaToken: "pending-1", factors: [{ id: "f1", factorType: "totp" }] }
        });

        function withMfa() {
            const mfa = {
                challenge: jest.fn().mockResolvedValue({ challengeId: "ch1", factorId: "f1", expiresAt: "later" }),
                verifyChallenge: jest.fn().mockResolvedValue(undefined)
            };
            mockAuth.mfa = mfa;
            return mfa;
        }

        it("opens the challenge with the sign-in's pending token and hands back its id", async () => {
            const mfa = withMfa();
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            let challengeId: string | undefined;
            await act(async () => {
                challengeId = await result.current.startMfaChallenge!("pending-1", "f1");
            });

            expect(mfa.challenge).toHaveBeenCalledWith("f1", { mfaToken: "pending-1" });
            expect(challengeId).toBe("ch1");
        });

        it("answers it with the same token, and drops the MFA_REQUIRED refusal once it is answered", async () => {
            const mfa = withMfa();
            mockAuth.signInWithEmail.mockRejectedValue(mfaRequired);
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                try { await result.current.emailPasswordLogin("mfa@rebase.pro", "pw"); } catch { /* expected */ }
            });
            expect(result.current.authProviderError).toBe(mfaRequired);

            await act(async () => {
                await result.current.verifyMfaChallenge!("pending-1", "ch1", "418293");
            });

            expect(mfa.verifyChallenge).toHaveBeenCalledWith("ch1", "418293", { mfaToken: "pending-1" });
            // Left in place, a later sign-out would open the login screen on
            // a code step for a token that has long expired.
            expect(result.current.authProviderError).toBeNull();
            expect(result.current.authLoading).toBe(false);
        });

        it("leaves the MFA_REQUIRED refusal in place when a code is refused, and rethrows", async () => {
            const mfa = withMfa();
            const refused = Object.assign(new Error("Invalid verification code"), { code: "INVALID_CODE" });
            mfa.verifyChallenge.mockRejectedValue(refused);
            mockAuth.signInWithEmail.mockRejectedValue(mfaRequired);
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => {
                try { await result.current.emailPasswordLogin("mfa@rebase.pro", "pw"); } catch { /* expected */ }
            });
            await act(async () => {
                await expect(result.current.verifyMfaChallenge!("pending-1", "ch1", "000000")).rejects.toBe(refused);
            });

            // The code step reports its own refusals; the sign-in is still
            // the one waiting for a second factor.
            expect(result.current.authProviderError).toBe(mfaRequired);
            expect(result.current.authLoading).toBe(false);
        });

        it("offers neither method when the client cannot answer a challenge", () => {
            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            expect(result.current.startMfaChallenge).toBeUndefined();
            expect(result.current.verifyMfaChallenge).toBeUndefined();
        });
    });

    // ─── getAuthToken ────────────────────────────────────────────────

    describe("getAuthToken", () => {
        it("should return access token from current SDK session", async () => {
            const futureSession = {
                ...mockSession,
                expiresAt: Date.now() + 3600 * 1000
            };
            mockAuth.getSession.mockReturnValue(futureSession);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => { await Promise.resolve(); });

            const token = await result.current.getAuthToken();
            expect(token).toBe("access_token_123");
            expect(mockAuth.refreshSession).not.toHaveBeenCalled();
        });

        it("should refresh when token is near expiry", async () => {
            const nearExpired = { ...mockSession, expiresAt: Date.now() + 5000 };
            const refreshed = { ...mockSession, accessToken: "new_token", expiresAt: Date.now() + 3600 * 1000 };
            mockAuth.getSession.mockReturnValue(nearExpired);
            mockAuth.refreshSession.mockResolvedValue(refreshed);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => { await Promise.resolve(); });

            const token = await result.current.getAuthToken();
            expect(token).toBe("new_token");
            expect(mockAuth.refreshSession).toHaveBeenCalled();
        });

        it("should throw when no auth is available", async () => {
            const { result } = renderHook(() => useRebaseAuthController({}));

            await expect(result.current.getAuthToken())
                .rejects.toThrow("Rebase client with auth is required");
        });
    });

    // ─── skipLogin ───────────────────────────────────────────────────

    describe("skipLogin", () => {
        it("should set loginSkipped and clear user", async () => {
            // Start from a signed-in session: `user` is already null on a fresh
            // mount, so "clears the user" is unfalsifiable without one to clear.
            mockAuth.getSession.mockReturnValue(mockSession);

            const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

            await act(async () => { await Promise.resolve(); });
            expect(result.current.user?.uid).toBe("123");

            act(() => {
                result.current.skipLogin();
            });

            expect(result.current.loginSkipped).toBe(true);
            expect(result.current.user).toBeNull();
        });
    });

    // ─── Capabilities ────────────────────────────────────────────────

    describe("capabilities", () => {
        it("should reflect auth config in capabilities", async () => {
            mockAuth.getAuthConfig.mockResolvedValue({
                needsSetup: false,
                registrationEnabled: true,
                passwordReset: true,
                emailVerification: true,
                enabledProviders: ["google", "github"]
            });

            const { result } = renderHook(() => useRebaseAuthController({
                client: mockClient,
                googleClientId: "google-client-id"
            }));

            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(result.current.capabilities?.registrationEnabled).toBe(true);
            expect(result.current.capabilities?.passwordReset).toBe(true);
            expect(result.current.capabilities?.emailVerification).toBe(true);
            expect(result.current.capabilities?.googleLogin).toBe(true);
            expect(result.current.capabilities?.enabledProviders).toEqual(["google", "github"]);
        });
    });
});
