import { createCustomAuthAdapter } from "../src/auth/custom-auth-adapter";
import type { AuthenticatedUser, AuthResponsePayload, CustomAuthAdapterOptions } from "@rebasepro/types";

const TEST_USER: AuthenticatedUser = {
    uid: "user-123",
    email: "test@example.com",
    displayName: "Test User",
    roles: ["editor"],
    isAdmin: false,
    rawToken: "tok_abc"
};

const ADMIN_USER: AuthenticatedUser = {
    uid: "admin-1",
    email: "admin@example.com",
    roles: ["admin"],
    isAdmin: true
};

describe("createCustomAuthAdapter", () => {
    it("sets the adapter id to 'custom'", () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null
        });
        expect(adapter.id).toBe("custom");
    });

    it("delegates verifyRequest to the provided function", async () => {
        const verifyRequest = jest.fn(async () => TEST_USER);
        const adapter = createCustomAuthAdapter({ verifyRequest });
        const req = new Request("http://localhost/api", {
            headers: { Authorization: "Bearer test-token" }
        });
        const result = await adapter.verifyRequest(req);
        expect(verifyRequest).toHaveBeenCalledWith(req);
        expect(result).toBe(TEST_USER);
    });

    it("returns null from verifyRequest when the user function returns null", async () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null
        });
        const result = await adapter.verifyRequest(new Request("http://localhost/"));
        expect(result).toBeNull();
    });

    // ── verifyToken (fallback via synthetic Request) ──────────────────

    it("synthesizes a Request when verifyToken is not provided", async () => {
        const verifyRequest = jest.fn(async (request: Request) => {
            const auth = request.headers.get("authorization");
            if (auth === "Bearer my-token") return TEST_USER;
            return null;
        });
        const adapter = createCustomAuthAdapter({ verifyRequest });

        expect(adapter.verifyToken).toBeDefined();

        const result = await adapter.verifyToken!("my-token");
        expect(result).toBe(TEST_USER);

        // Verify the synthetic request was created correctly
        expect(verifyRequest).toHaveBeenCalledTimes(1);
        const calledRequest = verifyRequest.mock.calls[0][0] as Request;
        expect(calledRequest.headers.get("authorization")).toBe("Bearer my-token");
        expect(calledRequest.url).toContain("_ws_auth");
    });

    it("returns null from fallback verifyToken for invalid token", async () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null
        });
        const result = await adapter.verifyToken!("bad-token");
        expect(result).toBeNull();
    });

    // ── verifyToken (direct passthrough) ──────────────────────────────

    it("uses the user-provided verifyToken when given", async () => {
        const customVerifyToken = jest.fn(async (token: string) => {
            if (token === "direct-token") return ADMIN_USER;
            return null;
        });
        const verifyRequest = jest.fn(async () => null);
        const adapter = createCustomAuthAdapter({
            verifyRequest,
            verifyToken: customVerifyToken
        });

        const result = await adapter.verifyToken!("direct-token");
        expect(result).toBe(ADMIN_USER);

        // verifyRequest should NOT be called — verifyToken takes precedence
        expect(verifyRequest).not.toHaveBeenCalled();
    });

    it("returns null from user-provided verifyToken for unknown token", async () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null,
            verifyToken: async () => null
        });
        const result = await adapter.verifyToken!("unknown");
        expect(result).toBeNull();
    });

    // ── Capabilities ──────────────────────────────────────────────────

    it("returns default capabilities when none are overridden", async () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null
        });
        const caps = await adapter.getCapabilities!();
        expect(caps).toEqual({
            hasBuiltInAuthRoutes: false,
            emailPasswordLogin: false,
            registrationEnabled: false,
            passwordReset: false,
            adminPasswordReset: false,
            sessionManagement: false,
            profileUpdate: false,
            emailVerification: false,
            magicLink: false,
            anonymousLogin: false,
            enabledProviders: []
        });
    });

    it("lets an adapter opt in to adminPasswordReset once it mounts the route", async () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null,
            capabilities: { adminPasswordReset: true }
        });
        const caps = await adapter.getCapabilities!();
        expect(caps.adminPasswordReset).toBe(true);
        // Opting in to admin reset must not imply the self-service email flow.
        expect(caps.passwordReset).toBe(false);
    });

    it("merges user-provided capabilities with defaults", async () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null,
            capabilities: { emailPasswordLogin: true,
registrationEnabled: true }
        });
        const caps = await adapter.getCapabilities!();
        expect(caps.emailPasswordLogin).toBe(true);
        expect(caps.registrationEnabled).toBe(true);
        expect(caps.hasBuiltInAuthRoutes).toBe(false);
    });

    // ── Optional fields ───────────────────────────────────────────────

    it("passes through serviceKey", () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null,
            serviceKey: "sk_live_123"
        });
        expect(adapter.serviceKey).toBe("sk_live_123");
    });

    it("passes through userManagement when provided", () => {
        const userMgmt = {
            getUser: jest.fn(),
            listUsers: jest.fn(),
            createUser: jest.fn(),
            updateUser: jest.fn(),
            deleteUser: jest.fn()
        };

        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null,
            userManagement: userMgmt as unknown as CustomAuthAdapterOptions["userManagement"]
        });

        expect(adapter.userManagement).toBe(userMgmt);
    });

    it("omits userManagement when not provided", () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null
        });
        expect(adapter.userManagement).toBeUndefined();
    });

    // ── transformAuthResponse ────────────────────────────────────────────

    it("passes through transformAuthResponse when provided", () => {
        const transformFn = jest.fn(async (response: AuthResponsePayload) => response);
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null,
            transformAuthResponse: transformFn
        });
        expect(adapter.transformAuthResponse).toBe(transformFn);
    });

    it("omits transformAuthResponse when not provided", () => {
        const adapter = createCustomAuthAdapter({
            verifyRequest: async () => null
        });
        expect(adapter.transformAuthResponse).toBeUndefined();
    });
});
