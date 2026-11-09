/**
 * EXPERIMENTAL. The admin panel's MCP endpoint: `POST /api/admin/apps/mcp`,
 * for the person signed in to the admin panel.
 *
 * The admin panel opens a saved app (`apps/saved-apps.ts`) the way Claude
 * opens one: the MCP App view in a sandboxed frame, its tool calls relayed
 * here. So an app runs in the admin panel exactly as in the conversation —
 * the same compiled code, the same view, the same data tools as the same
 * person under their RLS — and the frame holds no session: it has no network
 * of its own, and the page relays its calls.
 *
 * What it accepts: the backend's own session, through the auth adapter as
 * every data request is authenticated, with the roles the database holds now.
 * Not an anonymous session. A caller gets the `data:*` scopes, which reach no
 * further than the REST data API does for the same person: every call still
 * runs under their RLS.
 *
 * Independent of `REBASE_MCP_ENABLED`: no credential leaves the backend.
 *
 * @module
 */
import type { Hono } from "hono";
import type { HonoEnv } from "../api/types.js";
import { createMcpRoutes, type McpRoutesConfig } from "./mcp-routes.js";
import type { McpCaller } from "./mcp-tools.js";

/** Where it is mounted, under `basePath`. */
export const ADMIN_APPS_MCP_PATH = "/admin/apps/mcp";

/** What the admin panel's session may do through it: what the REST data API lets the same person do. */
const ADMIN_PANEL_SCOPES = ["data:read", "data:write", "data:delete"];

export type AdminAppsMcpConfig = Omit<McpRoutesConfig, "authenticate" | "resolveApiKey" | "identity" | "jwt" | "vocabulary">;

export function createAdminAppsMcpRoutes(config: AdminAppsMcpConfig): Hono<HonoEnv> {
    return createMcpRoutes({
        ...config,
        async authenticate(request): Promise<McpCaller | { refusal: string }> {
            const adapter = config.getAuthAdapter?.();
            if (!adapter) return { refusal: "This backend has no sign-in." };
            const user = await adapter.verifyRequest(request.raw).catch(() => null);
            if (!user) return { refusal: "Sign in to the admin panel to open saved apps." };
            if (user.isAnonymous) return { refusal: "An anonymous session cannot open saved apps." };
            return {
                uid: user.uid,
                roles: [...(user.roles ?? [])],
                scopes: ADMIN_PANEL_SCOPES,
                clientId: "admin-panel"
            };
        }
    });
}
