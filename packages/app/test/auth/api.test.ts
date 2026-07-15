import * as authApi from "../../src/auth/api";
import { RebaseApiError } from "@rebasepro/types";

const API_URL = "https://api.test.rebase.pro";

describe("auth API client", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe("fetchAuthConfig requests and network handling", () => {
        it("should GET the unauthenticated /config endpoint", async () => {
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

            const result = await authApi.fetchAuthConfig(API_URL, authApi.createAuthConfigCache());

            expect(global.fetch).toHaveBeenCalledWith("https://api.test.rebase.pro/api/auth/config", {
                method: "GET",
                headers: { "Content-Type": "application/json" }
            });
            expect(result).toEqual(configResponse);
        });

        it("throws the unified RebaseApiError (with status + code) on non-ok HTTP response", async () => {
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

            await expect(authApi.fetchAuthConfig(API_URL, authApi.createAuthConfigCache())).rejects.toMatchObject({
                name: "RebaseApiError",
                message: "Invalid credentials",
                code: "INVALID_CREDENTIALS",
                status: 401
            });
        });

        it("throws with code PARSE_ERROR if JSON parsing fails", async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => {
                    throw new Error("Invalid JSON");
                }
            });

            await expect(authApi.fetchAuthConfig(API_URL, authApi.createAuthConfigCache())).rejects.toMatchObject({
                message: "Server returned non-JSON response (status: 200)",
                code: "PARSE_ERROR"
            });
        });

        it("throws with code NETWORK_ERROR on failed connection", async () => {
            (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError("Failed to fetch"));

            await expect(authApi.fetchAuthConfig(API_URL, authApi.createAuthConfigCache())).rejects.toMatchObject({
                message: "Failed to connect to the backend server. The backend might be down or failed to initialize (e.g., database connection timeout).",
                code: "NETWORK_ERROR"
            });
        });

        it("AuthApiError is a deprecated alias of RebaseApiError", () => {
            expect(authApi.AuthApiError).toBe(RebaseApiError);
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
