/**
 * Custom Auth Adapter Factory
 *
 * Provides a minimal-config way for users with existing auth systems
 * to plug into Rebase. Only `verifyRequest` is required — everything
 * else is optional.
 *
 * @example
 * ```ts
 * import { createCustomAuthAdapter } from "@rebasepro/server";
 *
 * const auth = createCustomAuthAdapter({
 *   verifyRequest: async (request) => {
 *     const token = request.headers.get("Authorization")?.replace("Bearer ", "");
 *     if (!token) return null;
 *     const decoded = jwt.verify(token, MY_SECRET);
 *     return {
 *       uid: decoded.sub,
 *       email: decoded.email,
 *       displayName: decoded.name,
 *       roles: decoded.roles || [],
 *       isAdmin: decoded.roles?.includes("admin") ?? false,
 *     };
 *   },
 * });
 * ```
 */

import type {
    AuthAdapter,
    AuthAdapterCapabilities,
    CustomAuthAdapterOptions
} from "@rebasepro/types";

/**
 * Create a custom auth adapter from minimal options.
 *
 * This is the recommended entry point for users who already have their own
 * auth system and just need to tell Rebase how to extract the user from
 * incoming requests.
 *
 * @param options - Configuration options. Only `verifyRequest` is required.
 * @returns A fully-formed `AuthAdapter` ready for `initializeRebaseBackend()`.
 */
export function createCustomAuthAdapter(options: CustomAuthAdapterOptions): AuthAdapter {
    const defaultCapabilities: AuthAdapterCapabilities = {
        hasBuiltInAuthRoutes: false,
        emailPasswordLogin: false,
        registrationEnabled: false,
        passwordReset: false,
        // Off unless the adapter's own createAdminRoutes() mounts a
        // reset-password route and opts in via `capabilities`.
        adminPasswordReset: false,
        sessionManagement: false,
        profileUpdate: false,
        emailVerification: false,
        magicLink: false,
        anonymousLogin: false,
        enabledProviders: [],
        ...options.capabilities
    };

    const resolvedVerifyToken = options.verifyToken
        ?? (async (token: string) => {
            // Synthesize a minimal Request so adapters that only implement
            // verifyRequest still work for WebSocket token verification.
            const syntheticRequest = new Request("http://localhost/_ws_auth", {
                headers: { Authorization: `Bearer ${token}` }
            });
            return options.verifyRequest(syntheticRequest);
        });

    return {
        id: "custom",

        serviceKey: options.serviceKey,

        verifyRequest: options.verifyRequest,

        verifyToken: resolvedVerifyToken,

        userManagement: options.userManagement,

        transformAuthResponse: options.transformAuthResponse,

        getCapabilities() {
            return defaultCapabilities;
        }
    };
}
