/**
 * The admin panel's MCP endpoint (`mcp/admin-apps-mcp.ts`), experimental.
 *
 * - It answers the session the auth adapter verifies, and nothing else: no
 *   token, an unverified one, an anonymous session, no adapter.
 * - The person's live roles are the caller's, with the `data:*` scopes, so
 *   the data tools and the saved-app tools are offered.
 */
import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, AuthenticatedUser } from "@rebasepro/types";
import { createAdminAppsMcpRoutes } from "../src/mcp/admin-apps-mcp";
import { stubDriver } from "./helpers/mcp-harness";

function adapter(users: Record<string, { uid: string; roles: string[]; isAnonymous?: boolean }>): AuthAdapter {
    return {
        id: "test",
        verifyRequest: async (request: Request): Promise<AuthenticatedUser | null> => {
            const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
            const user = users[token];
            return user ? { ...user, email: "", isAdmin: user.roles.includes("admin") } : null;
        },
        getCapabilities: () => ({
            hasBuiltInAuthRoutes: false, emailPasswordLogin: false, registrationEnabled: false,
            passwordReset: false, adminPasswordReset: false, sessionManagement: false, profileUpdate: false,
            emailVerification: false, magicLink: false, anonymousLogin: false, enabledProviders: []
        })
    };
}

function app(auth?: AuthAdapter) {
    const router = new Hono();
    router.route("/api/admin/apps/mcp", createAdminAppsMcpRoutes({
        publicUrl: "http://localhost",
        mcpPath: "/api/admin/apps/mcp",
        oauthBasePath: "/api/oauth",
        getDriver: () => stubDriver().driver,
        getAuthAdapter: () => auth,
        serverInfo: { name: "rebase", version: "test" }
    }));
    return router;
}

async function call(router: Hono, token: string | undefined, method: string) {
    const res = await router.request("/api/admin/apps/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} })
    });
    return { status: res.status, body: await res.json().catch(() => undefined) as { result?: { tools?: { name: string }[] } } | undefined };
}

describe("the admin panel's MCP endpoint", () => {
    const users = adapter({ good: { uid: "u1", roles: ["editor"] }, anon: { uid: "a1", roles: [], isAnonymous: true } });

    it("refuses a request with no session, an unverified one, or an anonymous one", async () => {
        expect((await call(app(users), undefined, "tools/list")).status).toBe(401);
        expect((await call(app(users), "forged", "tools/list")).status).toBe(401);
        expect((await call(app(users), "anon", "tools/list")).status).toBe(401);
        expect((await call(app(undefined), "good", "tools/list")).status).toBe(401);
    });

    it("offers the signed-in person the data tools and the saved-app tools", async () => {
        const { status, body } = await call(app(users), "good", "tools/list");
        expect(status).toBe(200);
        const names = body?.result?.tools?.map(tool => tool.name) ?? [];
        expect(names).toEqual(expect.arrayContaining(["query_table", "create_row", "delete_row"]));
        // Offered only where the view is served; this test serves none.
        expect(names).not.toContain("open_app");
    });
});
