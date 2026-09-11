/**
 * The MCP endpoint: an OAuth 2.1 resource server speaking JSON-RPC.
 *
 * The protocol subset is deliberately hand-written rather than taken from
 * `@modelcontextprotocol/sdk`. The SDK's HTTP transport is built around Node's
 * `req`/`res`, this server is Hono, and the adapter would be more code than the
 * protocol — which, for a server that offers tools and neither prompts nor
 * sampling, is `initialize`, `tools/list`, `tools/call` and `ping`. It also
 * keeps a dependency out of `@rebasepro/server`, whose import graph feeds the
 * portable functions bundle.
 *
 * Streamable HTTP, in its simplest legal form: a POST carrying one JSON-RPC
 * message, answered with one JSON response. The specification permits a server
 * to answer `application/json` instead of opening an SSE stream, and nothing
 * here pushes server-initiated messages, so `GET /mcp` returns 405 with an
 * `Allow` header rather than pretending to hold a stream open.
 *
 * The authorization half is the part that matters, and it runs before any of
 * the above: no token is 401 with the `WWW-Authenticate` challenge that tells a
 * client where the authorization server is, a token for the wrong audience is
 * 401, and a token too narrow for the tool it names is 403 `insufficient_scope`.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../api/types.js";
import { logger } from "../utils/logger.js";
import { verifyMcpAccessToken } from "../auth/jwt.js";
import {
    canonicalResourceUri,
    bearerChallenge,
    insufficientScopeChallenge,
    protectedResourceMetadata,
    protectedResourceMetadataPath,
    authorizationServerMetadata,
    DEFAULT_MCP_SCOPE
} from "./oauth-metadata.js";
import { findTool, toolsForScope, McpToolError, type McpCaller } from "./mcp-tools.js";

/**
 * The protocol revisions this server implements.
 *
 * `initialize` echoes back the client's version when we know it, and our own
 * latest when we do not — which is what the specification asks for and what
 * keeps a client one revision ahead from failing the handshake outright.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** JSON-RPC 2.0 error codes, plus the one MCP adds. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface McpRoutesConfig {
    /** The externally reachable origin. */
    publicUrl: string;
    /** Where this router is mounted. */
    mcpPath: string;
    /** Where the OAuth endpoints live, for the AS metadata document. */
    oauthBasePath: string;
    /** Resolved per request, because a driver may be swapped at runtime. */
    getDriver(): DataDriver | undefined;
    getCollections(): CollectionConfig[];
    /** The server's own name and version, for `initialize`. */
    serverInfo: { name: string; version: string };
}

/**
 * The `.well-known` documents.
 *
 * Mounted at the ROOT, not under `basePath`, because RFC 8414 and RFC 9728 both
 * define the path relative to the origin — the same reason `jwks.json` sits
 * there. A client fetches these before it has any token, so they are public and
 * uncredentialed by design.
 */
export function createMcpWellKnownRoutes(config: McpRoutesConfig): Hono<HonoEnv> {
    // `wellKnown`, not `router`: this file builds two, and the endpoint index
    // keys a mount on `<file>#<receiver>`. Two receivers sharing a name collapse
    // to one key, and these two mount at DIFFERENT prefixes — `/` for the
    // metadata an MCP client fetches before it can authenticate, `/mcp` for the
    // protocol itself — so one of them could not be expressed at all.
    const wellKnown = new Hono<HonoEnv>();
    const resourcePath = protectedResourceMetadataPath(config.mcpPath);

    const serveResourceMetadata = (c: Context<HonoEnv>) =>
        c.json(protectedResourceMetadata(config.publicUrl, config.mcpPath));

    // The path-suffixed form is the one RFC 9728 §3.1 specifies for a resource
    // with a path. The bare form is served too, because clients in the wild ask
    // for it and answering costs nothing.
    wellKnown.get(resourcePath, serveResourceMetadata);
    wellKnown.get("/.well-known/oauth-protected-resource", serveResourceMetadata);

    wellKnown.get("/.well-known/oauth-authorization-server", (c) =>
        c.json(authorizationServerMetadata(config.publicUrl, config.oauthBasePath)));

    return wellKnown;
}

/** The MCP endpoint itself. */
export function createMcpRoutes(config: McpRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    const canonicalResource = canonicalResourceUri(config.publicUrl, config.mcpPath);

    /**
     * Nothing is served without a token bound to THIS resource.
     *
     * The challenge on a 401 is the client's entire discovery path: with no
     * token it knows only the URL, and `resource_metadata` is what turns that
     * into an authorization server, a registration endpoint and a consent
     * screen. Omitting it makes a protected server look like a broken one.
     */
    async function authenticate(c: Context<HonoEnv>): Promise<McpCaller | Response> {
        const header = c.req.header("authorization") ?? "";
        if (!header.toLowerCase().startsWith("bearer ")) {
            return c.json(
                { error: "unauthorized", error_description: "An OAuth access token is required." },
                401,
                { "WWW-Authenticate": bearerChallenge(config.publicUrl, config.mcpPath, DEFAULT_MCP_SCOPE) }
            );
        }

        const token = header.slice(7).trim();
        // The audience is passed explicitly on every call. `verifyMcpAccessToken`
        // has no default for it, so this is the check the specification requires
        // — a token minted for another Rebase project cannot be spent here.
        const payload = await verifyMcpAccessToken(token, canonicalResource);
        if (!payload) {
            return c.json(
                { error: "invalid_token", error_description: "The access token is invalid, expired, or for another resource." },
                401,
                { "WWW-Authenticate": bearerChallenge(config.publicUrl, config.mcpPath, DEFAULT_MCP_SCOPE) }
            );
        }

        return {
            uid: payload.uid,
            roles: payload.roles,
            scope: payload.scope,
            clientId: payload.clientId
        };
    }

    router.post("/", async (c) => {
        const caller = await authenticate(c);
        if (caller instanceof Response) return caller;

        let message: unknown;
        try {
            message = await c.req.json();
        } catch {
            return c.json(rpcError(null, PARSE_ERROR, "Invalid JSON."), 400);
        }

        // A batch is a JSON array. Answering each in order and dropping the
        // notifications' empty slots is all a batch means here.
        if (Array.isArray(message)) {
            const replies = [];
            for (const item of message) {
                const reply = await dispatch(c, item, caller);
                if (reply) replies.push(reply);
            }
            return replies.length ? c.json(replies) : c.body(null, 202);
        }

        const reply = await dispatch(c, message, caller);
        // A notification gets no body. 202 is what the specification asks for.
        return reply ? c.json(reply) : c.body(null, 202);
    });

    /**
     * No server-initiated stream.
     *
     * A client opens `GET /mcp` to receive messages the server starts. This one
     * never does — it answers tool calls and nothing else — so the honest reply
     * is 405 with `Allow`, not an SSE stream that stays silent forever and
     * leaves the client waiting on a heartbeat that is not coming.
     */
    router.get("/", async (c) => {
        // Authenticated the same way POST is, not by the mere PRESENCE of a
        // header. The first version checked only that `Authorization` was set,
        // so an expired or forged token was answered 405 — telling an
        // unauthenticated caller that the endpoint exists and what it accepts,
        // and telling a client with a stale token "wrong method" instead of the
        // challenge that would let it refresh.
        const caller = await authenticate(c);
        if (caller instanceof Response) return caller;

        return c.json(
            { error: "method_not_allowed", error_description: "This server does not open server-initiated streams." },
            405,
            { Allow: "POST, DELETE" }
        );
    });

    /** Session teardown. Stateless here, so there is nothing to tear down. */
    router.delete("/", (c) => c.body(null, 204));

    async function dispatch(
        c: Context<HonoEnv>,
        message: unknown,
        caller: McpCaller
    ): Promise<Record<string, unknown> | null> {
        if (typeof message !== "object" || message === null) {
            return rpcError(null, INVALID_REQUEST, "A JSON-RPC message must be an object.");
        }
        const { id = null, method, params } = message as {
            id?: string | number | null; method?: string; params?: Record<string, unknown>;
        };
        if (typeof method !== "string") {
            return rpcError(id, INVALID_REQUEST, "`method` is required.");
        }

        // Notifications carry no id and get no reply, whatever they say.
        //
        // Applied ONCE, to whatever the switch produced, rather than per case.
        // Three of the cases below did not check it and would have answered a
        // notification-shaped `tools/list` with a reply carrying `id: null` —
        // a message the client is not waiting for and cannot match. Deciding it
        // here means a method added later cannot forget.
        const isNotification = id === null || id === undefined;
        const reply = await route();
        return isNotification ? null : reply;

        async function route(): Promise<Record<string, unknown> | null> {
        switch (method) {
            case "initialize": {
                const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : undefined;
                return rpcResult(id, {
                    protocolVersion: asked && SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
                        ? asked
                        : LATEST_PROTOCOL_VERSION,
                    // Only tools. Declaring a capability this server does not
                    // implement makes a client call something that 404s.
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: config.serverInfo,
                    instructions:
                        "Data tools for this Rebase project. Every call runs as the signed-in user, " +
                        "so results are limited to what that user is allowed to see. " +
                        "Call list_collections first to learn the schema."
                });
            }

            case "notifications/initialized":
            case "notifications/cancelled":
                return null;

            case "ping":
                return rpcResult(id, {});

            case "tools/list":
                return rpcResult(id, {
                    tools: toolsForScope(caller.scope).map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema
                    }))
                });

            case "tools/call":
                return callTool(c, id, params, caller);

            default:
                return rpcError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
        }
        }
    }

    async function callTool(
        c: Context<HonoEnv>,
        id: string | number | null,
        params: Record<string, unknown> | undefined,
        caller: McpCaller
    ): Promise<Record<string, unknown>> {
        const name = typeof params?.name === "string" ? params.name : "";
        const args = (params?.arguments ?? {}) as Record<string, unknown>;

        const tool = findTool(name, caller.scope);
        if (!tool) {
            // A tool that exists but is out of scope is reported as a scope
            // problem, not as "unknown" — the client can act on the first and
            // only give up on the second. The HTTP 403 challenge cannot be sent
            // from inside a JSON-RPC result, so the guidance goes in the error.
            const outOfScope = toolsForScope("mcp:read mcp:write").find(t => t.name === name);
            if (outOfScope) {
                c.header("WWW-Authenticate", insufficientScopeChallenge(
                    config.publicUrl, config.mcpPath, outOfScope.requiredScope,
                    `${name} requires the ${outOfScope.requiredScope} scope`
                ));
                return rpcError(id, INVALID_PARAMS,
                    `"${name}" requires the ${outOfScope.requiredScope} scope, which this token does not hold.`);
            }
            return rpcError(id, METHOD_NOT_FOUND, `Unknown tool: ${name}`);
        }

        const driver = config.getDriver();
        if (!driver) {
            return rpcError(id, INTERNAL_ERROR, "The data layer is not ready.");
        }

        try {
            const result = await tool.run(args, {
                driver,
                collections: config.getCollections(),
                caller
            });
            return rpcResult(id, {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                structuredContent: result
            });
        } catch (error) {
            // A tool failure is a RESULT with `isError`, not a JSON-RPC error.
            // The distinction is the specification's and it matters: a protocol
            // error means the client sent something malformed, while this is the
            // model's call not working, and the model is the one that can fix it
            // by trying something else — so the message has to reach it.
            const message = error instanceof McpToolError
                ? error.message
                : "The call failed. This is usually a permission rule refusing the operation for your account.";
            if (!(error instanceof McpToolError)) {
                logger.error("[mcp] Tool call failed", {
                    tool: name, uid: caller.uid, clientId: caller.clientId, error
                });
            }
            return rpcResult(id, {
                content: [{ type: "text", text: message }],
                isError: true
            });
        }
    }

    return router;
}

function rpcResult(id: string | number | null, result: unknown): Record<string, unknown> {
    return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
    return { jsonrpc: "2.0", id, error: { code, message } };
}
