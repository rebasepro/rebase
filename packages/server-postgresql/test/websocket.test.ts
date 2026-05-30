import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";

let mockWssInstance: any = null;

jest.mock("ws", () => {
    return {
        WebSocketServer: jest.fn().mockImplementation(() => {
            const instance = {
                on: jest.fn()
            };
            mockWssInstance = instance;
            return instance;
        }),
        WebSocket: jest.fn()
    };
});

jest.mock("@rebasepro/server-core", () => {
    return {
        extractUserFromToken: jest.fn().mockReturnValue({
            userId: "admin-user",
            roles: ["admin"]
        })
    };
});

import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";

describe("WebSocket Server SQL error handling", () => {
    let mockServer: Server;
    let mockRealtimeService: RealtimeService;
    let mockDriver: PostgresBackendDriver;

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;

        mockServer = {} as Server;
        mockRealtimeService = {
            addClient: jest.fn(),
            registerDataDriverSubscription: jest.fn()
        } as unknown as RealtimeService;

        // Mock PostgresBackendDriver admin capabilities
        mockDriver = {
            key: "postgres",
            initialised: true,
            admin: {
                executeSql: jest.fn()
            }
        } as unknown as PostgresBackendDriver;

        // Trigger the wss initialization with requireAuth: true
        createPostgresWebSocket(mockServer, mockRealtimeService, mockDriver, { requireAuth: true });
    });

    it("should handle EXECUTE_SQL errors cleanly and return ERROR message without throwing", async () => {
        expect(mockWssInstance).toBeDefined();
        expect(mockWssInstance.on).toHaveBeenCalledWith("connection", expect.any(Function));
        
        const connectionCallback = mockWssInstance.on.mock.calls.find(
            (call: any[]) => call[0] === "connection"
        )[1];

        // Simulate client connection
        const mockWs = {
            on: jest.fn(),
            send: jest.fn()
        } as unknown as any;

        connectionCallback(mockWs);

        // Retrieve the message callback
        expect(mockWs.on).toHaveBeenCalledWith("message", expect.any(Function));
        const messageCallback = mockWs.on.mock.calls.find(
            (call: any[]) => call[0] === "message"
        )[1];

        // 1. Authenticate first as an admin
        await messageCallback(
            Buffer.from(
                JSON.stringify({
                    type: "AUTHENTICATE",
                    requestId: "auth-req",
                    payload: {
                        token: "mock-admin-token"
                    }
                })
            )
        );

        expect(mockWs.send).toHaveBeenCalled();
        const authResponse = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(authResponse.type).toBe("AUTH_SUCCESS");

        // Clear mock send calls before executing SQL
        mockWs.send.mockClear();

        // Mock executeSql to throw a permission denied error
        (mockDriver.admin.executeSql as jest.Mock).mockRejectedValueOnce(
            new Error("permission denied for table orders")
        );

        // 2. Simulate receiving EXECUTE_SQL message
        await messageCallback(
            Buffer.from(
                JSON.stringify({
                    type: "EXECUTE_SQL",
                    requestId: "req-1",
                    payload: {
                        sql: "SELECT * FROM orders",
                        options: { role: "demo" }
                    }
                })
            )
        );

        // Verify executeSql was called
        expect(mockDriver.admin.executeSql).toHaveBeenCalledWith("SELECT * FROM orders", { role: "demo" });

        // Verify the client received a clean ERROR payload rather than crashing the socket
        expect(mockWs.send).toHaveBeenCalled();
        const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(sentMessage).toEqual({
            type: "ERROR",
            requestId: "req-1",
            payload: {
                error: {
                    message: "permission denied for table orders",
                    code: "SQL_ERROR"
                }
            }
        });
    });
});
