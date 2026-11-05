/**
 * The platform's MCP endpoint: `POST /api/admin/mcp`, for platform tokens only.
 *
 * The hosted Rebase connector (docs/hosted-mcp-connector.md) lets a developer
 * reach their Cloud projects' data from one MCP connection. The control plane
 * does not run the data tools itself: it signs a platform token for the
 * person and the project (`auth/platform-token.ts`) and forwards the call
 * here, where the app's own MCP tools (`mcp-tools.ts`) run it — with this
 * app's collections, callbacks, auth-collection rules and RLS, at the version
 * that is deployed.
 *
 * What it accepts: an `rpt_` token verified against the platform's public key
 * and this project's audience, granted at most {@link PLATFORM_MCP_SCOPES}.
 * Nothing else — no OAuth access token, no `rk_` key, no session. It serves no
 * discovery documents: no third party is meant to find it.
 *
 * Who a call runs as: `platform:<sub>` with the `admin` role, under RLS (the
 * default policies' admin arm passes; `serverContext()` does not). That is the
 * reach of the identity the platform's Studio uses, and the control plane
 * grants it to the same people: the project's organization owners and admins,
 * with Studio switched on for the project.
 *
 * Independent of `REBASE_MCP_ENABLED`: that is the app owner's decision to
 * hand credentials to third-party software, and turning this on hands none.
 *
 * @module
 */
import type { Hono } from "hono";
import type { HonoEnv } from "../api/types.js";
import { logger } from "../utils/logger.js";
import { extractBearerToken } from "../auth/bearer-token.js";
import {
    isPlatformToken,
    verifyPlatformToken,
    PLATFORM_MCP_SCOPES,
    type PlatformTokenConfig
} from "../auth/platform-token.js";
import { createMcpRoutes, type McpRoutesConfig } from "./mcp-routes.js";
import type { McpCaller } from "./mcp-tools.js";

/** Where it is mounted, under `basePath`. */
export const PLATFORM_MCP_PATH = "/admin/mcp";

/** The role a platform data call runs with: the platform Studio's. */
const PLATFORM_DATA_ROLES = ["admin"];

export type PlatformMcpConfig = Omit<McpRoutesConfig, "authenticate" | "resolveApiKey" | "identity" | "jwt" | "tools" | "vocabulary"> & {
    platformTokens: PlatformTokenConfig;
};

export function createPlatformMcpRoutes(config: PlatformMcpConfig): Hono<HonoEnv> {
    return createMcpRoutes({
        ...config,
        async authenticate(request): Promise<McpCaller | { refusal: string }> {
            const token = extractBearerToken(request.header("authorization"));
            if (token === undefined || !isPlatformToken(token)) {
                return { refusal: "This endpoint accepts platform tokens only." };
            }
            const verified = await verifyPlatformToken(token, config.platformTokens, undefined, PLATFORM_MCP_SCOPES);
            if ("refusal" in verified) return verified;
            // The line an owner looks for when asking who read what in their
            // app on the platform's say-so. `jti`, not `tokenId`: the logger
            // redacts any key that names a token, and the id is no secret.
            logger.info("[Auth] Platform token accepted", {
                subject: verified.subject,
                jti: verified.tokenId,
                scopes: verified.scopes,
                method: request.method,
                path: request.path
            });
            return {
                uid: `platform:${verified.subject}`,
                roles: PLATFORM_DATA_ROLES,
                scopes: verified.scopes,
                clientId: `platform:${verified.tokenId ?? verified.subject}`
            };
        }
    });
}
