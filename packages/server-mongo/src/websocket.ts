import { RealtimeProvider, DataDriver, FetchCollectionProps, FetchOneProps, SaveProps, DeleteProps, TableMetadata, DatabaseAdmin, isSchemaAdmin, isDocumentAdmin, User, AuthAdapter } from "@rebasepro/types";
import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { inspect } from "util";
import { extractUserFromToken, resolveRequireAuth, assertWriteRequestValid, ApiError } from "@rebasepro/server";
import type { RebaseAuthConfig } from "@rebasepro/server";
import { MongoRealtimeService } from "./services/MongoRealtimeService";
import { MongoDriver } from "./services/MongoDriver";
import { logger } from "@rebasepro/server";

interface DriverWithAuth extends DataDriver {
    withAuth(user: Record<string, unknown>): Promise<DataDriver>;
}

function isDriverWithAuth(driver: DataDriver): driver is DriverWithAuth {
    return "withAuth" in driver && typeof (driver as Record<string, unknown>).withAuth === "function";
}

/**
 * Normalized user identity for WebSocket sessions — the same shape the Postgres
 * socket keeps, because an `AuthAdapter` user is not an access-token payload.
 */
interface WsUserIdentity {
    uid: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
    roles: string[];
    isAdmin: boolean;
}

interface ClientSession {
    ws: WebSocket;
    user?: WsUserIdentity;
    authenticated: boolean;
    messageCount: number;
    messageWindowStart: number;
}

const WS_RATE_LIMIT = 2000;
const WS_RATE_WINDOW_MS = 60_000;

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

function isAdminSession(session: ClientSession | undefined): boolean {
    if (!session?.user) return false;
    // The adapter's own answer first; a role *named* `admin` is only the
    // fallback for the built-in JWT path.
    if (session.user.isAdmin) return true;
    return (session.user.roles ?? []).some((r) => r === "admin");
}

export function createMongoWebSocket(
    server: Server,
    realtimeService: MongoRealtimeService,
    driver: MongoDriver,
    authConfig?: RebaseAuthConfig,
    admin?: DatabaseAdmin,
    authAdapter?: AuthAdapter
) {
    // Scoped to this factory invocation rather than the module, so sessions do
    // not leak across hot reloads or a second server on the same process — the
    // Postgres socket keeps it here for the same reason.
    const clientSessions = new Map<string, ClientSession>();

    const isProduction = process.env.NODE_ENV === "production";
    const wsDebug = (...args: unknown[]) => { if (!isProduction) console.debug(...args); };
    const wss = new WebSocketServer({ server });

    wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") return;
        logger.error("❌ [WebSocket Server] Error", { error: err });
    });

    // The same predicate the HTTP data routes use, from the same function. See
    // `resolveRequireAuth` for what this socket's local copy got wrong — most
    // importantly that a `false` here does not skip a check, it marks every
    // session `authenticated` at connect time.
    const requireAuth = !!authAdapter || resolveRequireAuth(authConfig);

    if (requireAuth && !authAdapter && !authConfig?.jwtSecret) {
        logger.warn(
            "🔐 [WebSocket Server] Authentication is required but no adapter or jwtSecret is " +
            "configured — no client can complete AUTH, so every realtime message will be refused."
        );
    }

    wss.on("connection", (ws) => {
        const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        wsDebug(`WebSocket client connected: ${clientId}`);

        clientSessions.set(clientId, { ws,
authenticated: !requireAuth,
messageCount: 0,
messageWindowStart: Date.now() });
        realtimeService.addClient(clientId, ws);

        ws.on("close", () => {
            wsDebug(`WebSocket client disconnected: ${clientId}`);
            clientSessions.delete(clientId);
        });

        ws.on("message", async (message) => {
            let requestId: string | undefined;
            try {
                const { type, payload, requestId: reqId } = JSON.parse(message.toString());
                requestId = reqId;

                wsDebug(`[WS] ${clientId} → ${type}`, requestId ? `(${requestId})` : "");

                const sendError = (errType: "ERROR" | "AUTH_ERROR", code: string, msg: string) => {
                    ws.send(JSON.stringify({ type: errType,
requestId,
payload: { error: { message: msg,
code } } }));
                };

                if (type === "AUTHENTICATE") {
                    const { token } = payload || {};
                    if (!token) {
                        sendError("AUTH_ERROR", "INVALID_INPUT", "Token is required");
                        return;
                    }

                    // The adapter verifies when one is configured, exactly as the
                    // HTTP routes do; the built-in JWT path is the fallback.
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
                                    email: adapterUser.email,
                                    roles: adapterUser.roles ?? [],
                                    isAdmin: !!adapterUser.isAdmin
                                };
                            }
                        } catch {
                            // Adapter threw — treat as invalid token
                        }
                    } else {
                        const jwtPayload = extractUserFromToken(token);
                        if (jwtPayload) {
                            verifiedUser = {
                                uid: jwtPayload.uid,
                                email: jwtPayload.email,
                                displayName: jwtPayload.displayName,
                                photoURL: jwtPayload.photoURL,
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
                        ws.send(JSON.stringify({ type: "AUTH_SUCCESS",
requestId,
payload: { uid: verifiedUser.uid,
roles: verifiedUser.roles } }));
                    } else {
                        sendError("AUTH_ERROR", "INVALID_TOKEN", "Invalid or expired token");
                    }
                    return;
                }

                if (requireAuth) {
                    const session = clientSessions.get(clientId);
                    if (!session?.authenticated) {
                        sendError("ERROR", "UNAUTHORIZED", "Authentication required");
                        return;
                    }
                }

                {
                    const session = clientSessions.get(clientId);
                    if (session) {
                        const now = Date.now();
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

                if (ADMIN_ONLY_TYPES.has(type)) {
                    const session = clientSessions.get(clientId);
                    if (!isAdminSession(session)) {
                        sendError("ERROR", "FORBIDDEN", "Admin access required for this operation");
                        return;
                    }
                }

                /** @see the Postgres socket — same rule, same reason. */
                const assertWriteRequest = (path: string | undefined, values: unknown): void => {
                    if (!path || !values || typeof values !== "object") return;
                    const collection = driver.registry?.getCollectionByPath(path);
                    if (!collection) return;
                    assertWriteRequestValid(values as Record<string, unknown>, collection);
                };

                const getScopedDelegate = async (): Promise<DataDriver> => {
                    const session = clientSessions.get(clientId);
                    if (session?.user && isDriverWithAuth(driver)) {
                        try {
                            const userForAuth: User = {
                                uid: session.user.uid,
                                email: session.user.email ?? "",
                                displayName: session.user.displayName ?? "",
                                photoURL: session.user.photoURL ?? "",
                                providerId: "jwt",
                                isAnonymous: false,
                                roles: session.user.roles ?? []
                            };
                            return await driver.withAuth(userForAuth);
                        } catch (e) {
                            logger.error("Failed to create authenticated delegate for WS request", { error: e });
                            return driver;
                        }
                    }
                    return driver;
                };

                switch (type) {
                    case "FETCH_COLLECTION": {
                        const request: FetchCollectionProps = payload;
                        const delegate = await getScopedDelegate();
                        const rows = await delegate.fetchCollection(request);
                        ws.send(JSON.stringify({ type: "FETCH_COLLECTION_SUCCESS",
payload: { rows },
requestId }));
                        break;
                    }
                    case "FETCH_ONE": {
                        const request: FetchOneProps = payload;
                        const delegate = await getScopedDelegate();
                        const row = await delegate.fetchOne(request);
                        ws.send(JSON.stringify({ type: "FETCH_ONE_SUCCESS",
payload: { row },
requestId }));
                        break;
                    }
                    case "SAVE": {
                        const request: SaveProps = payload;
                        // The REST layer's write checks, at this boundary too —
                        // the socket is a second way in, and it used to be the
                        // unchecked one. Collection from the registry by path,
                        // never from the client's `request.collection`.
                        assertWriteRequest(request.path, request.values as Record<string, unknown>);
                        const delegate = await getScopedDelegate();
                        const row = await delegate.save(request);
                        ws.send(JSON.stringify({ type: "SAVE_SUCCESS",
payload: { row },
requestId }));
                        break;
                    }
                    case "DELETE": {
                        const request: DeleteProps = payload;
                        const delegate = await getScopedDelegate();
                        await delegate.delete(request);
                        ws.send(JSON.stringify({ type: "DELETE_SUCCESS",
payload: { success: true },
requestId }));
                        break;
                    }
                    case "CHECK_UNIQUE_FIELD": {
                        const { path, name, value, id, collection } = payload;
                        const delegate = await getScopedDelegate();
                        const isUnique = await delegate.checkUniqueField(path, name, value, id, collection);
                        ws.send(JSON.stringify({ type: "CHECK_UNIQUE_FIELD_SUCCESS",
payload: { isUnique },
requestId }));
                        break;
                    }
                    case "COUNT": {
                        const request: FetchCollectionProps = payload;
                        const delegate = await getScopedDelegate();
                        const count = await delegate.count!(request);
                        ws.send(JSON.stringify({ type: "COUNT_SUCCESS",
payload: { count },
requestId }));
                        break;
                    }
                    case "EXECUTE_SQL": {
                        const { sql, options } = payload;
                        if (admin && isDocumentAdmin(admin) && admin.executeAggregate) {
                            const result = await admin.executeAggregate(sql as Record<string, unknown>[]);
                            ws.send(JSON.stringify({ type: "EXECUTE_SQL_SUCCESS",
payload: { result },
requestId }));
                        } else {
                            ws.send(JSON.stringify({ type: "ERROR",
requestId,
payload: { error: { message: "SQL execution not supported for this driver",
code: "NOT_SUPPORTED" } } }));
                        }
                        break;
                    }
                    case "FETCH_UNMAPPED_TABLES": {
                        if (admin && isSchemaAdmin(admin)) {
                            const tables = await admin.fetchUnmappedTables?.(payload?.mappedPaths) || [];
                            ws.send(JSON.stringify({ type: "FETCH_UNMAPPED_TABLES_SUCCESS",
payload: { tables },
requestId }));
                        } else {
                            ws.send(JSON.stringify({ type: "FETCH_UNMAPPED_TABLES_SUCCESS",
payload: { tables: [] },
requestId }));
                        }
                        break;
                    }
                    case "FETCH_TABLE_METADATA": {
                        const { tableName } = payload;
                        if (admin && isSchemaAdmin(admin)) {
                            const metadata = await admin.fetchTableMetadata?.(tableName);
                            ws.send(JSON.stringify({ type: "FETCH_TABLE_METADATA_SUCCESS",
payload: { metadata },
requestId }));
                        } else {
                            ws.send(JSON.stringify({ type: "FETCH_TABLE_METADATA_SUCCESS",
payload: { metadata: null },
requestId }));
                        }
                        break;
                    }
                    case "subscribe_collection":
                    case "subscribe_one":
                    case "unsubscribe": {
                        const session = clientSessions.get(clientId);
                        const authContext = session?.user ? { uid: session.user.uid,
roles: session.user.roles ?? [] } : undefined;
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
                // A refused write keeps its message: it is the only thing that
                // tells the caller what to send instead, and the generic branch
                // below drops it in production.
                if (error instanceof ApiError || (error as Error)?.name === "ApiError") {
                    const apiError = error as ApiError;
                    ws.send(JSON.stringify({ type: "ERROR",
requestId,
payload: { error: { message: apiError.message,
code: apiError.code } } }));
                    return;
                }
                const errorMessage = process.env.NODE_ENV === "production" ? "An unexpected error occurred" : (error instanceof Error ? error.message : "An unexpected error occurred");
                ws.send(JSON.stringify({ type: "ERROR",
requestId,
payload: { error: { message: errorMessage,
code: "INTERNAL_ERROR" } } }));
            }
        });
    });
}
