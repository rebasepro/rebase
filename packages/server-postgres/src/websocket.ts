import { RealtimeService } from "./services/realtimeService";
import { PostgresBackendDriver } from "./PostgresBackendDriver";
import type { DataDriver, DeleteProps, FetchCollectionProps, FetchOneProps, SaveProps, TableMetadata, BranchInfo, AuthAdapter } from "@rebasepro/types";
import { ANONYMOUS_USER_ID, isSQLAdmin, isSchemaAdmin, resolveClientListLimit } from "@rebasepro/types";
import type { User } from "@rebasepro/types";

import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { inspect } from "util";
import { extractUserFromToken, AccessTokenPayload, safeCompare, resolveRequireAuth } from "@rebasepro/server";
import { logger } from "@rebasepro/server";

/** Minimal subset of RebaseAuthConfig used by the WebSocket layer. */
interface WsAuthConfig {
    requireAuth?: boolean;
    jwtSecret?: string;
    /**
     * Same static server-to-server secret the HTTP middleware accepts. Without
     * it here, a service key authenticates over HTTP but not over the socket —
     * so any SDK client using one (scripts, cron, server-to-server) connects,
     * fails realtime auth with "jwt malformed", and silently gets no events.
     */
    serviceKey?: string;
}

/**
 * Normalized user identity for WebSocket sessions.
 */
interface WsUserIdentity {
    uid: string;
    roles: string[];
    isAdmin: boolean;
}

interface ClientSession {
    ws: WebSocket;
    user?: WsUserIdentity;
    authenticated: boolean;
    /** Sliding window message counter for rate limiting */
    messageCount: number;
    messageWindowStart: number;
    /** The same window, counted separately for channel frames. */
    channelMessageCount: number;
    channelWindowStart: number;
}


/** Maximum messages per client per window */
const WS_RATE_LIMIT = 2000;
/** Rate limit window in milliseconds (60 seconds) */
const WS_RATE_WINDOW_MS = 60_000;

/**
 * Channel frames get their own budget, because they are a different workload.
 *
 * 2000/minute is 33/second, which is generous for queries and subscriptions and
 * an order of magnitude below what the documented channel idiom asks for: the
 * capacity note in `docs/backend/realtime.md` uses 60 fps cursor movement as
 * its worked example, and the presence idiom re-`track()`s on every move, so
 * one client sustaining that sends ~120 frames/second — 7200 a minute. Sharing
 * one counter meant the cursor stream ate the query budget and then froze for
 * the rest of the window.
 *
 * The number is sized to that documented workload and nothing more; it is not
 * a considered product limit (see `docs/channel-authorization.md`).
 */
const WS_CHANNEL_RATE_LIMIT = 7200;

/** Frames counted against the channel budget rather than the general one. */
const CHANNEL_MESSAGE_TYPES = new Set([
    "join_channel",
    "leave_channel",
    "broadcast",
    "presence_track",
    "presence_untrack",
    "presence_state",
    "channel_history"
]);

/** Admin-only WebSocket message types */
const ADMIN_ONLY_TYPES = new Set([
    "EXECUTE_SQL",
    "FETCH_DATABASES",
    "FETCH_ROLES",
    "FETCH_UNMAPPED_TABLES",
    "FETCH_TABLE_METADATA",
    "FETCH_CURRENT_DATABASE",
    "CREATE_BRANCH",
    "DELETE_BRANCH",
    "LIST_BRANCHES"
]);

/**
 * Recursively extract the deepest error message from an error's cause chain (e.g., Drizzle wrapping a PG error).
 */
function extractErrorMessage(error: unknown): string {
    if (!error) return "Unknown error";
    if (error instanceof Error) {
        if ("cause" in error && error.cause) {
            return extractErrorMessage(error.cause);
        }
        return error.message;
    }
    if (typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
        return (error as { message: string }).message;
    }
    return String(error);
}

/**
 * Check if the current session belongs to an admin user.
 */
function isAdminSession(session: ClientSession | undefined): boolean {
    if (!session?.user) return false;
    // Fast path: new adapter-aware sessions set isAdmin directly
    if (session.user.isAdmin) return true;
    if (!session.user.roles) return false;
    return session.user.roles.some((r) => r === "admin");
}

export function createPostgresWebSocket(
    server: Server,
    realtimeService: RealtimeService,
    driver: PostgresBackendDriver,
    authConfig?: WsAuthConfig,
    authAdapter?: AuthAdapter
) {
    // Session map scoped to this factory invocation — prevents stale sessions
    // leaking across hot reloads or multiple factory calls.
    const clientSessions = new Map<string, ClientSession>();

    const isProduction = process.env.NODE_ENV === "production";
    /** Debug logger that is suppressed in production to prevent PII/data leaks */
    const wsDebug = (...args: unknown[]) => { if (!isProduction) console.debug(...args); };
    const wss = new WebSocketServer({ server });

    // Handle errors on the WSS so that EADDRINUSE from the underlying HTTP
    // server doesn't surface as an unhandled 'error' event and crash the
    // process.  The dev-mode `listenWithPortRetry` utility handles retry
    // logic on the HTTP server side — we just need the WSS not to throw.
    wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            // Silently absorbed — listenWithPortRetry will retry the next port
            return;
        }
        logger.error("❌ [WebSocket Server] Error", { error: err });
    });

    // The same predicate the HTTP data routes use, from the same function —
    // this socket is the other enforcement point for one product decision, and
    // while it computed the answer itself it computed a different one. See
    // `resolveRequireAuth` for what its local copy got wrong and why a `false`
    // here grants access rather than skipping a check.
    const requireAuth = !!authAdapter || resolveRequireAuth(authConfig as never);

    if (requireAuth && !authAdapter && !authConfig?.jwtSecret && !authConfig?.serviceKey) {
        logger.warn(
            "🔐 [WebSocket Server] Authentication is required but no adapter, jwtSecret or " +
            "serviceKey is configured — no client can complete AUTH, so every realtime " +
            "message will be refused with UNAUTHORIZED."
        );
    }

    wss.on("connection", (ws) => {
        const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        wsDebug(`WebSocket client connected: ${clientId}`);

        // Initialize client session
        clientSessions.set(clientId, { ws,
authenticated: !requireAuth,
messageCount: 0,
messageWindowStart: Date.now(),
channelMessageCount: 0,
channelWindowStart: Date.now() });
        realtimeService.addClient(clientId, ws);

        ws.on("close", () => {
            wsDebug(`WebSocket client disconnected: ${clientId}`);
            clientSessions.delete(clientId);
        });

        // Route all messages through RealtimeService for unified handling
        ws.on("message", async (message) => {
            let requestId: string | undefined;
            try {
                const {
                    type,
                    payload,
                    requestId: reqId
                } = JSON.parse(message.toString());
                requestId = reqId; // Capture requestId for use in catch block

                wsDebug(`[WS] ${clientId} → ${type}`, requestId ? `(${requestId})` : "");

                // Handle authentication first
                // Helper: send a canonical error frame
                const sendError = (errType: "ERROR" | "AUTH_ERROR", code: string, msg: string) => {
                    ws.send(JSON.stringify({
                        type: errType,
                        requestId,
                        payload: { error: { message: msg,
code } }
                    }));
                };

                if (type === "AUTHENTICATE") {
                    const { token } = payload || {};
                    if (!token) {
                        sendError("AUTH_ERROR", "INVALID_INPUT", "Token is required");
                        return;
                    }

                    // Use the auth adapter when available (custom auth, Clerk, etc.)
                    // Fall back to JWT extraction otherwise.
                    let verifiedUser: WsUserIdentity | null = null;

                    if (authAdapter) {
                        try {
                            const adapterUser = authAdapter.verifyToken
                                ? await authAdapter.verifyToken(token)
                                : await authAdapter.verifyRequest(new Request("http://localhost/_ws_auth", {
                                    headers: { Authorization: `Bearer ${token}` }
                                }));

                            if (adapterUser) {
                                verifiedUser = {
                                    uid: adapterUser.uid,
                                    roles: adapterUser.roles,
                                    isAdmin: adapterUser.isAdmin
                                };
                            }
                        } catch {
                            // Adapter threw — treat as invalid token
                        }
                    } else if (authConfig?.serviceKey && safeCompare(token, authConfig.serviceKey)) {
                        // Service key: a static secret, not a JWT. Checked
                        // before verification, mirroring the HTTP middleware —
                        // verifying it as a JWT can only ever fail.
                        verifiedUser = { uid: "service", roles: ["admin"], isAdmin: true };
                    } else {
                        // Standard JWT path
                        const jwtPayload = extractUserFromToken(token);
                        if (jwtPayload) {
                            verifiedUser = {
                                uid: jwtPayload.uid,
                                roles: jwtPayload.roles ?? [],
                                isAdmin: (jwtPayload.roles ?? []).some((r: string) => r === "admin")
                            };
                        }
                    }

                    if (verifiedUser) {
                        const session = clientSessions.get(clientId);
                        if (session) {
                            session.user = verifiedUser;
                            session.authenticated = true;
                        }
                        wsDebug(`[WS] replying AUTH_SUCCESS for requestId ${requestId}`);
                        ws.send(JSON.stringify({
                            type: "AUTH_SUCCESS",
                            requestId,
                            payload: { uid: verifiedUser.uid,
roles: verifiedUser.roles }
                        }));
                        wsDebug(`🔐 [WebSocket Server] Client ${clientId} authenticated as ${verifiedUser.uid}`);
                    } else {
                        wsDebug(`[WS] replying AUTH_ERROR for requestId ${requestId} (invalid token)`);
                        sendError("AUTH_ERROR", "INVALID_TOKEN", "Invalid or expired token");
                    }
                    return;
                }

                // Check authentication for protected operations
                if (requireAuth) {
                    const session = clientSessions.get(clientId);
                    if (!session?.authenticated) {
                        sendError("ERROR", "UNAUTHORIZED", "Authentication required");
                        return;
                    }
                }

                // Rate limiting: reject if client exceeds message limit.
                // Channel frames are counted against their own budget — see
                // WS_CHANNEL_RATE_LIMIT for why one shared counter starved them.
                {
                    const session = clientSessions.get(clientId);
                    if (session) {
                        const now = Date.now();
                        const isChannelFrame = CHANNEL_MESSAGE_TYPES.has(type);
                        if (isChannelFrame) {
                            if (now - session.channelWindowStart > WS_RATE_WINDOW_MS) {
                                session.channelMessageCount = 0;
                                session.channelWindowStart = now;
                            }
                            session.channelMessageCount++;
                            if (session.channelMessageCount > WS_CHANNEL_RATE_LIMIT) {
                                sendError("ERROR", "RATE_LIMITED", "Too many channel messages. Please slow down.");
                                return;
                            }
                        } else {
                            if (now - session.messageWindowStart > WS_RATE_WINDOW_MS) {
                                session.messageCount = 0;
                                session.messageWindowStart = now;
                            }
                            session.messageCount++;
                            if (session.messageCount > WS_RATE_LIMIT) {
                                sendError("ERROR", "RATE_LIMITED", "Too many requests. Please slow down.");
                                return;
                            }
                        }
                    }
                }

                // Admin-only operations require admin role
                if (ADMIN_ONLY_TYPES.has(type)) {
                    const session = clientSessions.get(clientId);
                    if (!isAdminSession(session)) {
                        sendError("ERROR", "FORBIDDEN", "Admin access required for this operation");
                        return;
                    }
                }

                // Helper to get correctly scoped delegate for the current request
                const getScopedDelegate = async (): Promise<DataDriver> => {
                    const session = clientSessions.get(clientId);
                    // Check if the driver supports RLS-scoped delegates
                    if (typeof driver.withAuth === "function") {
                        try {
                            const userForAuth: User = session?.user
                                ? {
                                    uid: session.user.uid,
                                    displayName: null,
                                    email: null,
                                    photoURL: null,
                                    providerId: "websocket",
                                    isAnonymous: false,
                                    roles: session.user.roles ?? []
                                }
                                : {
                                    uid: ANONYMOUS_USER_ID,
                                    displayName: null,
                                    email: null,
                                    photoURL: null,
                                    providerId: "websocket",
                                    isAnonymous: true,
                                    roles: ["anon"]
                                };
                            return await driver.withAuth(userForAuth);
                        } catch (e) {
                            logger.error("Failed to create RLS scoped delegate for WS request", { error: e });
                            throw new Error("Internal authentication error");
                        }
                    }
                    return driver;
                };

                switch (type) {
                    case "FETCH_COLLECTION": {
                        wsDebug("📋 [WebSocket Server] Processing FETCH_COLLECTION request");
                        const request: FetchCollectionProps = payload;
                        const delegate = await getScopedDelegate();
                        // Bound the client-supplied limit with the SAME guarantee
                        // the REST ingress and `subscribe_collection` apply
                        // (`resolveClientListLimit`). Without it an absent limit
                        // reached the driver as `undefined`, which emits no LIMIT
                        // clause — one socket frame streamed the whole table, on
                        // the one transport that skipped the ceiling every other
                        // read path enforces.
                        const rows = await delegate.fetchCollection({
                            ...request,
                            limit: resolveClientListLimit(request.limit, {
                                vectorSearch: !!request.vectorSearch
                            })
                        });
                        wsDebug("📋 [WebSocket Server] FETCH_COLLECTION result - rows count:", rows.length);
                        const response = {
                            type: "FETCH_COLLECTION_SUCCESS",
                            payload: { rows },
                            requestId
                        };
                        wsDebug("📋 [WebSocket Server] Sending FETCH_COLLECTION_SUCCESS response");
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "FETCH_ONE": {
                        wsDebug("📄 [WebSocket Server] Processing FETCH_ENTITY request");
                        const request: FetchOneProps = payload;
                        const delegate = await getScopedDelegate();
                        const row = await delegate.fetchOne(request);
                        wsDebug("📄 [WebSocket Server] FETCH_ENTITY result:", row);
                        const response = {
                            type: "FETCH_ONE_SUCCESS",
                            payload: { row: row ?? null },
                            requestId
                        };
                        wsDebug("📄 [WebSocket Server] Sending FETCH_ENTITY_SUCCESS response");
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "SAVE": {
                        wsDebug("💾 [WebSocket Server] Processing SAVE_ENTITY request");
                        const request: SaveProps = payload;
                        wsDebug("💾 [WebSocket Server] Saving row with request:", inspect(request, { depth: null,
colors: true }));
                        const delegate = await getScopedDelegate();
                        const row = await delegate.save(request);
                        wsDebug("💾 [WebSocket Server] SAVE_ENTITY result:", inspect(row, { depth: null,
colors: true }));
                        const response = {
                            type: "SAVE_SUCCESS",
                            payload: { row },
                            requestId
                        };
                        wsDebug("💾 [WebSocket Server] Sending SAVE_ENTITY_SUCCESS response");
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "DELETE": {
                        wsDebug("🗑️ [WebSocket Server] Processing DELETE_ENTITY request");
                        const request: DeleteProps = payload;
                        wsDebug("🗑️ [WebSocket Server] Deleting row:", request.row);
                        const delegate = await getScopedDelegate();
                        await delegate.delete(request);
                        wsDebug("🗑️ [WebSocket Server] DELETE_ENTITY completed successfully");
                        const response = {
                            type: "DELETE_SUCCESS",
                            payload: { success: true },
                            requestId
                        };
                        wsDebug("🗑️ [WebSocket Server] Sending DELETE_ENTITY_SUCCESS response");
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "CHECK_UNIQUE_FIELD": {
                        wsDebug("🔍 [WebSocket Server] Processing CHECK_UNIQUE_FIELD request");
                        const {
                            path,
                            name,
                            value,
                            id,
                            collection
                        } = payload;
                        const delegate = await getScopedDelegate();
                        const isUnique = await delegate.checkUniqueField(path, name, value, id, collection);
                        wsDebug("🔍 [WebSocket Server] CHECK_UNIQUE_FIELD result:", isUnique);
                        const response = {
                            type: "CHECK_UNIQUE_FIELD_SUCCESS",
                            payload: { isUnique },
                            requestId
                        };
                        wsDebug("🔍 [WebSocket Server] Sending CHECK_UNIQUE_FIELD_SUCCESS response");
                        ws.send(JSON.stringify(response));
                    }
                        break;


                    case "COUNT": {
                        // Deliberately NOT routed through `resolveClientListLimit`:
                        // this answers with a scalar, and the driver drops `limit`
                        // on the way to `SELECT count(*)`. Clamping here could only
                        // ever make `total` describe fewer rows than the collection
                        // holds — the page size is the caller's business, the total
                        // is not.
                        const request: FetchCollectionProps = payload;
                        const delegate = await getScopedDelegate();
                        const count = await delegate.count!(request);
                        const response = {
                            type: "COUNT_SUCCESS",
                            payload: { count },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "EXECUTE_SQL": {
                        const { sql, options } = payload;
                        try {
                            const delegate = await getScopedDelegate();
                            const admin = delegate.admin;
                            if (!isSQLAdmin(admin)) {
                                sendError("ERROR", "NOT_SUPPORTED", "SQL execution is not available for this driver.");
                                break;
                            }
                            const result = await admin.executeSql(sql, options);
                            if (process.env.NODE_ENV !== "production") {
                                wsDebug(`⚡ [WebSocket Server] SQL executed. Returned ${Array.isArray(result) ? result.length : "non-array"} rows.`);
                            }
                            const auditSession = clientSessions.get(clientId);
                            // Through `logger`, not `console.log`: this line is
                            // emitted in production, and a bare console call
                            // has no severity, no timestamp, no JSON envelope
                            // and no LOG_LEVEL gate, so it lands in Cloud
                            // Logging as unstructured text the queries written
                            // for every other line cannot match.
                            //
                            // The bound values are counted, never written — the
                            // statement is the audit signal, the parameters are
                            // whatever row the operator was touching. (stdout is
                            // not an audit sink either; a real trail belongs in
                            // a table with an actor and a retention policy.)
                            logger.info("[SQL Audit] WebSocket SQL execution", {
                                sql: typeof sql === "string" ? sql.substring(0, 500) : String(sql),
                                database: options?.database,
                                role: options?.role,
                                paramCount: Array.isArray(options?.params) ? options.params.length : 0,
                                resultRows: Array.isArray(result) ? result.length : "unknown",
                                uid: auditSession?.user?.uid ?? "unknown",
                                roles: auditSession?.user?.roles ?? [],
                                isAdmin: auditSession?.user?.isAdmin ?? false,
                                requestId
                            });
                            const response = {
                                type: "EXECUTE_SQL_SUCCESS",
                                payload: { result },
                                requestId
                            };
                            ws.send(JSON.stringify(response));
                        } catch (sqlError: unknown) {
                            // This is a query execution error (e.g., syntax error, permission denied).
                            // We return it cleanly to the client without logging a server stack trace.
                            const errMsg = extractErrorMessage(sqlError);
                            sendError("ERROR", "SQL_ERROR", errMsg);
                        }
                    }
                        break;

                    case "FETCH_DATABASES": {
                        wsDebug("📚 [WebSocket Server] Processing FETCH_DATABASES request");
                        const delegate = await getScopedDelegate();
                        const admin = delegate.admin;
                        let databases: string[] = [];
                        if (isSQLAdmin(admin) && admin.fetchAvailableDatabases) {
                            databases = await admin.fetchAvailableDatabases();
                        }
                        wsDebug(`📚 [WebSocket Server] Fetched ${databases.length} databases.`);
                        const response = {
                            type: "FETCH_DATABASES_SUCCESS",
                            payload: { databases },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "FETCH_ROLES": {
                        wsDebug("👤 [WebSocket Server] Processing FETCH_ROLES request");
                        const delegate = await getScopedDelegate();
                        const admin = delegate.admin;
                        let roles: string[] = [];
                        if (isSQLAdmin(admin) && admin.fetchAvailableRoles) {
                            roles = await admin.fetchAvailableRoles();
                        }
                        wsDebug(`👤 [WebSocket Server] Fetched ${roles.length} roles.`);
                        const response = {
                            type: "FETCH_ROLES_SUCCESS",
                            payload: { roles },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "FETCH_APPLICATION_ROLES": {
                        wsDebug("👤 [WebSocket Server] Processing FETCH_APPLICATION_ROLES request");
                        const delegate = await getScopedDelegate();
                        const admin = delegate.admin;
                        let roles: string[] = [];
                        if (isSQLAdmin(admin) && admin.fetchApplicationRoles) {
                            roles = await admin.fetchApplicationRoles();
                        }
                        wsDebug(`👤 [WebSocket Server] Fetched ${roles.length} application roles.`);
                        const response = {
                            type: "FETCH_APPLICATION_ROLES_SUCCESS",
                            payload: { roles },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "FETCH_CURRENT_DATABASE": {
                        wsDebug("📚 [WebSocket Server] Processing FETCH_CURRENT_DATABASE request");
                        const delegate = await getScopedDelegate();
                        const admin = delegate.admin;
                        let database: string | undefined = undefined;
                        if (isSQLAdmin(admin) && admin.fetchCurrentDatabase) {
                            database = await admin.fetchCurrentDatabase();
                        }
                        const response = {
                            type: "FETCH_CURRENT_DATABASE_SUCCESS",
                            payload: { database },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "FETCH_UNMAPPED_TABLES": {
                        wsDebug("📋 [WebSocket Server] Processing FETCH_UNMAPPED_TABLES request");
                        const delegate = await getScopedDelegate();
                        const admin = delegate.admin;
                        let tables: string[] = [];
                        if (isSchemaAdmin(admin) && admin.fetchUnmappedTables) {
                            tables = await admin.fetchUnmappedTables(payload?.mappedPaths);
                        }
                        wsDebug(`📋 [WebSocket Server] Fetched ${tables.length} unmapped tables.`);
                        const response = {
                            type: "FETCH_UNMAPPED_TABLES_SUCCESS",
                            payload: { tables },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "FETCH_TABLE_METADATA": {
                        wsDebug("📋 [WebSocket Server] Processing FETCH_TABLE_METADATA request");
                        const { tableName } = payload;
                        const delegate = await getScopedDelegate();
                        const admin = delegate.admin;
                        let metadata: TableMetadata | undefined;
                        if (isSchemaAdmin(admin) && admin.fetchTableMetadata) {
                            metadata = await admin.fetchTableMetadata(tableName) as TableMetadata;
                        }
                        wsDebug(`📋 [WebSocket Server] Fetched metadata for table '${tableName}'. (${metadata?.columns?.length ?? 0} columns)`);
                        const response = {
                            type: "FETCH_TABLE_METADATA_SUCCESS",
                            payload: { metadata },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "CREATE_BRANCH": {
                        wsDebug("🌿 [WebSocket Server] Processing CREATE_BRANCH request");
                        const { name, options } = payload;
                        const delegate = await getScopedDelegate();
                        if (!delegate.admin?.createBranch) {
                            sendError("ERROR", "NOT_SUPPORTED", "Database branching is not available. Configure adminConnectionString.");
                            break;
                        }
                        const branch: BranchInfo = await delegate.admin.createBranch(name, options);
                        wsDebug(`🌿 [WebSocket Server] Branch created: ${branch.name}`);
                        const response = {
                            type: "CREATE_BRANCH_SUCCESS",
                            payload: { branch },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "DELETE_BRANCH": {
                        wsDebug("🗑️ [WebSocket Server] Processing DELETE_BRANCH request");
                        const { name: branchName } = payload;
                        const delegate = await getScopedDelegate();
                        if (!delegate.admin?.deleteBranch) {
                            sendError("ERROR", "NOT_SUPPORTED", "Database branching is not available.");
                            break;
                        }
                        await delegate.admin.deleteBranch(branchName);
                        wsDebug(`🗑️ [WebSocket Server] Branch deleted: ${branchName}`);
                        const response = {
                            type: "DELETE_BRANCH_SUCCESS",
                            payload: { success: true },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    case "LIST_BRANCHES": {
                        wsDebug("🌿 [WebSocket Server] Processing LIST_BRANCHES request");
                        const delegate = await getScopedDelegate();
                        let branches: BranchInfo[] = [];
                        if (delegate.admin?.listBranches) {
                            branches = await delegate.admin.listBranches();
                        }
                        wsDebug(`🌿 [WebSocket Server] Listed ${branches.length} branches.`);
                        const response = {
                            type: "LIST_BRANCHES_SUCCESS",
                            payload: { branches },
                            requestId
                        };
                        ws.send(JSON.stringify(response));
                    }
                        break;

                    // Route subscription messages, broadcast channels, and presence to RealtimeService
                    case "subscribe_collection":
                    case "subscribe_one":
                    case "unsubscribe":
                    case "join_channel":
                    case "leave_channel":
                    case "broadcast":
                    case "presence_track":
                    case "presence_untrack":
                    case "presence_state":
                    case "channel_history": {
                        wsDebug("🔄 [WebSocket Server] Routing realtime message to RealtimeService:", type);
                        // Attach auth context from the WS session so RLS-aware refetches work
                        const session = clientSessions.get(clientId);
                        const authContext = session?.user
                            ? { uid: session.user.uid,
roles: session.user.roles ?? [] }
                            : { uid: ANONYMOUS_USER_ID,
roles: ["anon"] };
                        // Let RealtimeService handle these messages
                        await realtimeService.handleClientMessage(clientId, {
                            type,
                            payload,
                            subscriptionId: payload?.subscriptionId
                        }, authContext);
                        break;
                    }

                    default:
                        logger.error("❌ [WebSocket Server] Unknown message type", { detail: type });
                }
            } catch (error: unknown) {
                logger.error("💥 [WebSocket Server] Error handling message", { error: error });
                if (error instanceof Error) {
                    logger.error("Stack trace", { detail: error.stack });
                }
                // Unwrap the cause chain: a Drizzle failure reports itself as
                // "Failed query: <sql> params:", which tells the user nothing and
                // echoes the statement back at them. The reason is in the cause.
                const errorMessage = process.env.NODE_ENV === "production"
                    ? "An unexpected error occurred"
                    : extractErrorMessage(error);
                const errorResponse = {
                    type: "ERROR",
                    requestId,
                    payload: {
                        error: {
                            message: errorMessage,
                            code: "INTERNAL_ERROR"
                        }
                    }
                };
                ws.send(JSON.stringify(errorResponse));
            }
        });
    });
}
