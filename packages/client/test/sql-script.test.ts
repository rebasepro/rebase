import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseWebSocketClient } from "../src/websocket";
import { readSqlScriptResult } from "../src/sql-script";

/**
 * The SQL console's runs, on the client side.
 *
 * The console wrote an edited cell back to a row it found by guessing from
 * the query's text. The server now says, per result column, which table
 * column the database read it from; this is the half that asks for that and
 * reads it — and that reads a server which does not say as saying nothing, so
 * the console edits no cell of what it cannot trace.
 */

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    onerror?: (error: unknown) => void;
    sentMessages: string[] = [];

    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    constructor(readonly url: string) {
        MockWebSocket.instances.push(this);
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.onopen?.();
        }, 10);
    }

    send(data: string) {
        this.sentMessages.push(data);
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
    }
}

let client: RebaseWebSocketClient;

async function connected(): Promise<MockWebSocket> {
    client = new RebaseWebSocketClient({
        websocketUrl: "ws://localhost:1234",
        WebSocket: MockWebSocket as unknown as typeof WebSocket
    });
    client.ensureConnected();
    jest.runAllTimers();
    await Promise.resolve();
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

function lastFrame(ws: MockWebSocket): { type: string; requestId: string; payload: Record<string, unknown> } {
    return JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
}

beforeEach(() => {
    MockWebSocket.instances = [];
    jest.useFakeTimers();
    jest.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
    client?.disconnect(true);
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("runSqlScript", () => {
    it("asks for a script run, on the database and as the role given", async () => {
        const ws = await connected();

        const pending = client.runSqlScript("SELECT p.id, a.name FROM posts p JOIN authors a ON a.id = p.author_id", { database: "app", role: "reader" });
        const frame = lastFrame(ws);
        expect(frame.type).toBe("EXECUTE_SQL");
        expect(frame.payload).toEqual({
            sql: "SELECT p.id, a.name FROM posts p JOIN authors a ON a.id = p.author_id",
            options: { database: "app", role: "reader" },
            mode: "script"
        });

        ws.onmessage!({ data: JSON.stringify({
            type: "EXECUTE_SQL_SUCCESS",
            requestId: frame.requestId,
            payload: {
                result: [{ id: "1", name: "Ada" }],
                columns: [
                    { name: "id", type: "integer", source: { schema: "public", table: "posts", column: "id" } },
                    { name: "name", type: "text", source: { schema: "public", table: "authors", column: "name" } }
                ],
                tables: [
                    { schema: "public", table: "posts", kind: "table", primaryKey: ["id"], hasInheritors: false },
                    { schema: "public", table: "authors", kind: "table", primaryKey: ["id"], hasInheritors: false }
                ],
                command: "SELECT",
                rowCount: 1,
                notices: [{ severity: "WARNING", message: "there is no transaction in progress" }]
            }
        }) });

        await expect(pending).resolves.toEqual({
            rows: [{ id: "1", name: "Ada" }],
            columns: [
                { name: "id", type: "integer", source: { schema: "public", table: "posts", column: "id" } },
                { name: "name", type: "text", source: { schema: "public", table: "authors", column: "name" } }
            ],
            tables: [
                { schema: "public", table: "posts", kind: "table", primaryKey: ["id"], hasInheritors: false },
                { schema: "public", table: "authors", kind: "table", primaryKey: ["id"], hasInheritors: false }
            ],
            command: "SELECT",
            rowCount: 1,
            notices: [{ severity: "WARNING", message: "there is no transaction in progress" }]
        });
    });
});

describe("readSqlScriptResult", () => {
    it("reads a server that sent rows alone as saying nothing about where they came from", () => {
        const result = readSqlScriptResult({ result: [{ id: 7, status: "new", tags: ["a"], note: null }] });

        expect(result.rows).toEqual([{ id: "7", status: "new", tags: "[\"a\"]", note: null }]);
        expect(result.columns).toEqual([{ name: "id" }, { name: "status" }, { name: "tags" }, { name: "note" }]);
        expect(result.tables).toEqual([]);
        expect(result.notices).toEqual([]);
    });

    it("reads the role the server says the script ran as", () => {
        expect(readSqlScriptResult({ result: [], effectiveRole: "app_owner" }).effectiveRole).toBe("app_owner");
        expect(readSqlScriptResult({ result: [] }).effectiveRole).toBeUndefined();
        expect(readSqlScriptResult({ result: [], effectiveRole: 7 }).effectiveRole).toBeUndefined();
    });

    it("drops a source it cannot read, and reads an unknown inheritance as the unsafe answer", () => {
        const result = readSqlScriptResult({
            result: [],
            columns: [{ name: "id", source: { schema: "public", table: 3 } }, { name: 5 }],
            tables: [{ schema: "public", table: "events", kind: "table", primaryKey: ["id"] }]
        });

        expect(result.columns).toEqual([{ name: "id" }]);
        expect(result.tables).toEqual([{ schema: "public", table: "events", kind: "table", primaryKey: ["id"], hasInheritors: true }]);
    });
});
