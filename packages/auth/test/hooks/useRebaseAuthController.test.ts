import { renderHook, act } from "@testing-library/react";
import { useRebaseAuthController } from "../../src/hooks/useRebaseAuthController";
import * as authApi from "../../src/api";

const STORAGE_KEY = "rebase_react_auth";

describe("useRebaseAuthController hook", () => {
    let mockClient: any;

    beforeEach(() => {
        localStorage.clear();
        jest.useFakeTimers();

        mockClient = {
            baseUrl: "https://api.test.rebase.pro",
            setAuthTokenGetter: jest.fn(),
            setOnUnauthorized: jest.fn(),
            ws: {
                setAuthTokenGetter: jest.fn()
            }
        };

        // Spy on authApi functions and provide basic defaults
        jest.spyOn(authApi, "fetchAuthConfig").mockResolvedValue({
            needsSetup: false,
            registrationEnabled: true,
            enabledProviders: ["google"]
        });
        jest.spyOn(authApi, "getCurrentUser").mockResolvedValue({
            user: {
                uid: "123",
                email: "test@rebase.pro",
                displayName: "Test User",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        });
        jest.spyOn(authApi, "login").mockResolvedValue({
            user: {
                uid: "123",
                email: "test@rebase.pro",
                displayName: "Test User",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            tokens: {
                accessToken: "access_token_123",
                refreshToken: "refresh_token_123",
                accessTokenExpiresAt: Date.now() + 3600 * 1000 // 1 hour validity
            }
        });
        jest.spyOn(authApi, "refreshAccessToken").mockResolvedValue({
            tokens: {
                accessToken: "new_access_token",
                refreshToken: "new_refresh_token",
                accessTokenExpiresAt: Date.now() + 3600 * 1000
            }
        });
        jest.spyOn(authApi, "logout").mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("should mount in initial unauthenticated state", async () => {
        const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

        expect(result.current.initialLoading).toBe(true);
        expect(result.current.user).toBeNull();

        // Let the restoreAuth useEffect resolve
        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.initialLoading).toBe(false);
        expect(result.current.user).toBeNull();
    });

    it("should restore user from valid stored session in localStorage", async () => {
        const storedData = {
            tokens: {
                accessToken: "access_token_123",
                refreshToken: "refresh_token_123",
                accessTokenExpiresAt: Date.now() + 1000 * 600 // 10 minutes from now
            },
            user: {
                uid: "123",
                email: "stored@rebase.pro",
                displayName: "Stored User",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedData));

        const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.initialLoading).toBe(false);
        expect(result.current.user).toEqual({
            uid: "123",
            email: "stored@rebase.pro",
            displayName: "Stored User",
            photoURL: null,
            providerId: "password",
            isAnonymous: false,
            emailVerified: undefined,
            roles: [],
            metadata: undefined
        });
    });

    it("should refresh token on mount if expired, and update user state", async () => {
        const storedData = {
            tokens: {
                accessToken: "expired_access_token",
                refreshToken: "refresh_token_123",
                accessTokenExpiresAt: Date.now() - 1000 // Expired 1s ago
            },
            user: {
                uid: "123",
                email: "expired@rebase.pro",
                displayName: "Expired User",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedData));

        const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

        await act(async () => {
            await Promise.resolve(); // Resolves restoreAuth
        });

        expect(authApi.refreshAccessToken).toHaveBeenCalledWith("https://api.test.rebase.pro", "refresh_token_123");
        expect(authApi.getCurrentUser).toHaveBeenCalledWith("https://api.test.rebase.pro", "new_access_token");

        expect(result.current.initialLoading).toBe(false);
        expect(result.current.user?.displayName).toBe("Test User"); // Updated user from getCurrentUser mock
    });

    it("should clear localStorage and log out if token refresh fails on mount", async () => {
        const storedData = {
            tokens: {
                accessToken: "expired_access_token",
                refreshToken: "invalid_refresh_token",
                accessTokenExpiresAt: Date.now() - 1000
            },
            user: {
                uid: "123",
                email: "expired@rebase.pro",
                displayName: "Expired User",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedData));

        // Mock refreshAccessToken failure
        (authApi.refreshAccessToken as jest.Mock).mockResolvedValueOnce(null);

        const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.initialLoading).toBe(false);
        expect(result.current.user).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("should successfully log in with email and password", async () => {
        const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            await result.current.emailPasswordLogin("test@rebase.pro", "password123");
        });

        expect(authApi.login).toHaveBeenCalledWith("https://api.test.rebase.pro", "test@rebase.pro", "password123");
        expect(result.current.user?.email).toBe("test@rebase.pro");
        expect(result.current.user?.displayName).toBe("Test User");

        // Verify stored in localStorage
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
        expect(stored.tokens.accessToken).toBe("access_token_123");
        expect(stored.user.uid).toBe("123");
    });

    it("should clear state and remove storage data on signOut", async () => {
        // Initial setup with active session
        const storedData = {
            tokens: {
                accessToken: "access_token_123",
                refreshToken: "refresh_token_123",
                accessTokenExpiresAt: Date.now() + 1000 * 600
            },
            user: {
                uid: "123",
                email: "active@rebase.pro",
                displayName: "Active User",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedData));

        const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.user).not.toBeNull();

        await act(async () => {
            await result.current.signOut();
        });

        expect(authApi.logout).toHaveBeenCalledWith("https://api.test.rebase.pro", "refresh_token_123");
        expect(result.current.user).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("should update profile and persist changes in state and localStorage", async () => {
        const storedData = {
            tokens: {
                accessToken: "access_token_123",
                refreshToken: "refresh_token_123",
                accessTokenExpiresAt: Date.now() + 1000 * 600
            },
            user: {
                uid: "123",
                email: "test@rebase.pro",
                displayName: "Original Name",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedData));

        jest.spyOn(authApi, "updateProfile").mockResolvedValueOnce({
            user: {
                uid: "123",
                email: "test@rebase.pro",
                displayName: "Updated Name",
                photoURL: "http://new-photo",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        });

        const { result } = renderHook(() => useRebaseAuthController({ client: mockClient }));

        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            await result.current.updateProfile("Updated Name", "http://new-photo");
        });

        expect(authApi.updateProfile).toHaveBeenCalledWith("https://api.test.rebase.pro", "access_token_123", "Updated Name", "http://new-photo");
        expect(result.current.user?.displayName).toBe("Updated Name");
        expect(result.current.user?.photoURL).toBe("http://new-photo");

        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
        expect(stored.user.displayName).toBe("Updated Name");
        expect(stored.user.photoURL).toBe("http://new-photo");
    });
});
