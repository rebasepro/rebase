import * as authApi from "../src/api";

const API_URL = "https://api.test.rebase.pro";

describe("auth API client", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe("API responses and network handling", () => {
        it("should successfully register a user", async () => {
            const mockResponse = {
                user: { uid: "123",
email: "test@rebase.pro",
createdAt: new Date().toISOString(),
updatedAt: new Date().toISOString() },
                tokens: { accessToken: "access_token_123",
refreshToken: "refresh_token_123",
accessTokenExpiresAt: 1234567890 }
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });

            const result = await authApi.register(API_URL, "test@rebase.pro", "password123", "Test User");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "test@rebase.pro",
password: "password123",
displayName: "Test User" })
            });
            expect(result).toEqual(mockResponse);
        });

        it("should successfully login a user", async () => {
            const mockResponse = {
                user: { uid: "123",
email: "test@rebase.pro",
createdAt: new Date().toISOString(),
updatedAt: new Date().toISOString() },
                tokens: { accessToken: "access_token_123",
refreshToken: "refresh_token_123",
accessTokenExpiresAt: 1234567890 }
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });

            const result = await authApi.login(API_URL, "test@rebase.pro", "password123");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "test@rebase.pro",
password: "password123" })
            });
            expect(result).toEqual(mockResponse);
        });

        it("should successfully login with Google", async () => {
            const mockResponse = {
                user: { uid: "123",
email: "google@rebase.pro",
createdAt: new Date().toISOString(),
updatedAt: new Date().toISOString() },
                tokens: { accessToken: "access_token_123",
refreshToken: "refresh_token_123",
accessTokenExpiresAt: 1234567890 }
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });

            const payload = { idToken: "google_id_token" };
            const result = await authApi.googleLogin(API_URL, payload);

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/google", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            expect(result).toEqual(mockResponse);
        });

        it("should successfully refresh access tokens", async () => {
            const mockResponse = {
                tokens: { accessToken: "new_access_token",
refreshToken: "new_refresh_token",
accessTokenExpiresAt: 1234567890 }
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });

            const result = await authApi.refreshAccessToken(API_URL, "old_refresh_token");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken: "old_refresh_token" })
            });
            expect(result).toEqual(mockResponse);
        });

        it("should successfully logout", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({})
            });

            await authApi.logout(API_URL, "refresh_token_123");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken: "refresh_token_123" })
            });
        });

        it("should throw AuthApiError on non-ok HTTP response", async () => {
            const mockErrorResponse = {
                error: {
                    message: "Invalid credentials",
                    code: "INVALID_CREDENTIALS"
                }
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => mockErrorResponse
            });

            await expect(authApi.login(API_URL, "test@rebase.pro", "wrongpass")).rejects.toThrow(
                new authApi.AuthApiError("Invalid credentials", "INVALID_CREDENTIALS")
            );
        });

        it("should throw AuthApiError with PARSE_ERROR if JSON parsing fails", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => {
                    throw new Error("Invalid JSON");
                }
            });

            await expect(authApi.login(API_URL, "test@rebase.pro", "password")).rejects.toThrow(
                new authApi.AuthApiError("Server returned non-JSON response (status: 200)", "PARSE_ERROR")
            );
        });

        it("should throw AuthApiError with NETWORK_ERROR on failed connection", async () => {
            (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError("Failed to fetch"));

            await expect(authApi.login(API_URL, "test@rebase.pro", "password")).rejects.toThrow(
                new authApi.AuthApiError(
                    "Failed to connect to the backend server. The backend might be down or failed to initialize (e.g., database connection timeout).",
                    "NETWORK_ERROR"
                )
            );
        });
    });

    describe("Oauth and Other Endpoints", () => {
        it("should execute linkedinLogin", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({})
            });

            await authApi.linkedinLogin(API_URL, "code123", "http://redirect");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/linkedin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "code123",
redirectUri: "http://redirect" })
            });
        });

        it("should execute oauthLogin for custom providers", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({})
            });

            await authApi.oauthLogin(API_URL, "github", { code: "github_code" });

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/github", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "github_code" })
            });
        });

        it("should execute getCurrentUser", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ user: { uid: "1" } })
            });

            const result = await authApi.getCurrentUser(API_URL, "accessTokenSecret");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/me", {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer accessTokenSecret"
                }
            });
            expect(result).toEqual({ user: { uid: "1" } });
        });

        it("should execute forgotPassword", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            await authApi.forgotPassword(API_URL, "user@rebase.pro");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user@rebase.pro" })
            });
        });

        it("should execute resetPassword", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            await authApi.resetPassword(API_URL, "reset_token", "new_password");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: "reset_token",
password: "new_password" })
            });
        });

        it("should execute changePassword", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            await authApi.changePassword(API_URL, "tok", "old", "new");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/change-password", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer tok"
                },
                body: JSON.stringify({ oldPassword: "old",
newPassword: "new" })
            });
        });

        it("should execute sendVerificationEmail", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            await authApi.sendVerificationEmail(API_URL, "tok");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/send-verification", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer tok"
                }
            });
        });

        it("should execute verifyEmail", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            await authApi.verifyEmail(API_URL, "verify_token");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/verify-email?token=verify_token", {
                method: "GET",
                headers: { "Content-Type": "application/json" }
            });
        });

        it("should execute updateProfile", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ user: { uid: "1" } })
            });

            await authApi.updateProfile(API_URL, "tok", "New Name", "http://photo");

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/me", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer tok"
                },
                body: JSON.stringify({ displayName: "New Name",
photoURL: "http://photo" })
            });
        });

        it("should execute fetchSessions, revokeSession, and revokeAllSessions", async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            await authApi.fetchSessions(API_URL, "tok", "refTok");
            expect(global.fetch).toHaveBeenLastCalledWith("https://api.test.rebase.pro/api/auth/sessions", {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer tok",
                    "X-Refresh-Token": "refTok"
                }
            });

            await authApi.revokeSession(API_URL, "tok", "session123");
            expect(global.fetch).toHaveBeenLastCalledWith("https://api.test.rebase.pro/api/auth/sessions/session123", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer tok"
                }
            });

            await authApi.revokeAllSessions(API_URL, "tok");
            expect(global.fetch).toHaveBeenLastCalledWith("https://api.test.rebase.pro/api/auth/sessions", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer tok"
                }
            });
        });
    });

    describe("AuthConfig caching behavior", () => {
        it("should cache successful auth config fetches and reuse in-flight promises", async () => {
            const cache = authApi.createAuthConfigCache();
            const configResponse = {
                needsSetup: false,
                registrationEnabled: true,
                enabledProviders: ["google"]
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => configResponse
            });

            // Call fetchAuthConfig multiple times concurrently
            const promise1 = authApi.fetchAuthConfig(API_URL, cache);
            const promise2 = authApi.fetchAuthConfig(API_URL, cache);

            const result1 = await promise1;
            const result2 = await promise2;

            expect(result1).toBe(result2); // Resolves to the exact same config object reference

            expect(result1).toEqual(configResponse);
            expect(result2).toEqual(configResponse);

            // Fetch count should be exactly 1
            expect(global.fetch).toHaveBeenCalledTimes(1);

            // Calling it again (after resolves) should return the cached response immediately
            const result3 = await authApi.fetchAuthConfig(API_URL, cache);
            expect(result3).toEqual(configResponse);
            expect(global.fetch).toHaveBeenCalledTimes(1);

            // Clear cache and call again - should make a second network request
            authApi.clearAuthConfigCache(cache);
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => configResponse
            });
            const result4 = await authApi.fetchAuthConfig(API_URL, cache);
            expect(result4).toEqual(configResponse);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });
});
