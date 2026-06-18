import { RealtimeProvider, DataDriver, FetchCollectionProps, FetchEntityProps, SaveEntityProps, DeleteEntityProps, TableMetadata, DatabaseAdmin, isSchemaAdmin, isDocumentAdmin, User } from "@rebasepro/types";
import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { inspect } from "util";
import type { AccessTokenPayload } from "@rebasepro/server-core";
import { extractUserFromToken } from "@rebasepro/server-core";
import type { RebaseAuthConfig } from "@rebasepro/server-core";
import { MongoRealtimeService } from "./services/MongoRealtimeService";
import { MongoDriver } from "./services/MongoDriver";

interface DriverWithAuth extends DataDriver {
    withAuth(user: Record<string, unknown>): Promise<DataDriver>;
}

function isDriverWithAuth(driver: DataDriver): driver is DriverWithAuth {
    return "withAuth" in driver && typeof (driver as Record<string, unknown>).withAuth === "function";
}

interface ClientSession {
    ws: WebSocket;
    user?: AccessTokenPayload;
    authenticated: boolean;
    messageCount: number;
    messageWindowStart: number;
}

const clientSessions = new Map<string, ClientSession>();
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
    if (!session?.user?.roles) return false;
    return session.user.roles.includes("admin");
}

export function createMongoWebSocket(
    server: Server,
    realtimeService: MongoRealtimeService,
    driver: MongoDriver,
    authConfig?: RebaseAuthConfig,
    admin?: DatabaseAdmin
) {
    const isProduction = process.env.NODE_ENV === "production";
    const wsDebug = (...args: unknown[]) => { if (!isProduction) console.debug(...args); };
    const wss = new WebSocketServer({ server });

    wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") return;
        console.error("❌ [WebSocket Server] Error:", err);
    });

    const requireAuth = authConfig?.requireAuth !== false && authConfig?.jwtSecret;

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

                    const user = extractUserFromToken(token);
                    if (user) {
                        const session = clientSessions.get(clientId);
                        if (session) {
                            session.user = user;
                            session.authenticated = true;
                        }
                        ws.send(JSON.stringify({ type: "AUTH_SUCCESS",
requestId,
payload: { userId: user.userId,
roles: user.roles } }));
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

                const getScopedDelegate = async (): Promise<DataDriver> => {
                    const session = clientSessions.get(clientId);
                    if (session?.user && isDriverWithAuth(driver)) {
                        try {
                            const userForAuth: User = {
                                uid: session.user.userId,
                                email: session.user.email ?? "",
                                displayName: session.user.displayName ?? "",
                                photoURL: session.user.photoURL ?? "",
                                providerId: "jwt",
                                isAnonymous: false,
                                roles: session.user.roles ?? []
                            };
                            return await driver.withAuth(userForAuth);
                        } catch (e) {
                            console.error("Failed to create authenticated delegate for WS request", e);
                            return driver;
                        }
                    }
                    return driver;
                };

                switch (type) {
                    case "FETCH_COLLECTION": {
                        const request: FetchCollectionProps = payload;
                        const delegate = await getScopedDelegate();
                        const entities = await delegate.fetchCollection(request);
                        ws.send(JSON.stringify({ type: "FETCH_COLLECTION_SUCCESS",
payload: { entities },
requestId }));
                        break;
                    }
                    case "FETCH_ENTITY": {
                        const request: FetchEntityProps = payload;
                        const delegate = await getScopedDelegate();
                        const entity = await delegate.fetchEntity(request);
                        ws.send(JSON.stringify({ type: "FETCH_ENTITY_SUCCESS",
payload: { entity },
requestId }));
                        break;
                    }
                    case "SAVE_ENTITY": {
                        const request: SaveEntityProps = payload;
                        const delegate = await getScopedDelegate();
                        const entity = await delegate.saveEntity(request);
                        ws.send(JSON.stringify({ type: "SAVE_ENTITY_SUCCESS",
payload: { entity },
requestId }));
                        break;
                    }
                    case "DELETE_ENTITY": {
                        const request: DeleteEntityProps = payload;
                        const delegate = await getScopedDelegate();
                        await delegate.deleteEntity(request);
                        ws.send(JSON.stringify({ type: "DELETE_ENTITY_SUCCESS",
payload: { success: true },
requestId }));
                        break;
                    }
                    case "CHECK_UNIQUE_FIELD": {
                        const { path, name, value, entityId, collection } = payload;
                        const delegate = await getScopedDelegate();
                        const isUnique = await delegate.checkUniqueField(path, name, value, entityId, collection);
                        ws.send(JSON.stringify({ type: "CHECK_UNIQUE_FIELD_SUCCESS",
payload: { isUnique },
requestId }));
                        break;
                    }
                    case "COUNT_ENTITIES": {
                        const request: FetchCollectionProps = payload;
                        const delegate = await getScopedDelegate();
                        const count = await delegate.countEntities!(request);
                        ws.send(JSON.stringify({ type: "COUNT_ENTITIES_SUCCESS",
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
                    case "subscribe_entity":
                    case "unsubscribe": {
                        const session = clientSessions.get(clientId);
                        const authContext = session?.user ? { userId: session.user.userId,
roles: session.user.roles ?? [] } : undefined;
                        await realtimeService.handleClientMessage(clientId, {
                            type,
                            payload,
                            subscriptionId: payload?.subscriptionId
                        }, authContext);
                        break;
                    }
                    default:
                        console.error("❌ [WebSocket Server] Unknown message type:", type);
                }
            } catch (error: unknown) {
                const errorMessage = process.env.NODE_ENV === "production" ? "An unexpected error occurred" : (error instanceof Error ? error.message : "An unexpected error occurred");
                ws.send(JSON.stringify({ type: "ERROR",
requestId,
payload: { error: { message: errorMessage,
code: "INTERNAL_ERROR" } } }));
            }
        });
    });
}
