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

    it("reads a result the server cut short, and the count of rows there were", () => {
        const result = readSqlScriptResult({ result: [{ g: "1" }], command: "SELECT", rowCount: 50_000, truncated: true });
        expect(result.truncated).toBe(true);
        expect(result.rowCount).toBe(50_000);

        expect(readSqlScriptResult({ result: [] }).truncated).toBeUndefined();
        expect(readSqlScriptResult({ result: [], truncated: "yes" }).truncated).toBeUndefined();
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

/**
 * Cancelling a console run. A server that takes `CANCEL_SQL` says so when the
 * socket signs in (`capabilities: ["cancel_sql"]`); only to such a server does
 * an aborted run send one, naming the run by its `requestId`. Against any
 * server the run's promise rejects at once with the signal's reason, so the
 * console is never left waiting on a statement it gave up on.
 */
describe("runSqlScript with a signal", () => {
    async function signedIn(capabilities?: string[]): Promise<MockWebSocket> {
        const ws = await connected();
        const auth = client.authenticate("token");
        const frame = lastFrame(ws);
        expect(frame.type).toBe("AUTHENTICATE");
        ws.onmessage!({ data: JSON.stringify({
            type: "AUTH_SUCCESS",
            requestId: frame.requestId,
            payload: { uid: "u1", roles: ["admin"], ...(capabilities ? { capabilities } : {}) }
        }) });
        await auth;
        return ws;
    }

    const frames = (ws: MockWebSocket) => ws.sentMessages.map((data) => JSON.parse(data) as { type: string; requestId: string; payload: Record<string, unknown> });

    it("sends CANCEL_SQL for the run to a server that takes it, and rejects at once", async () => {
        const ws = await signedIn(["cancel_sql"]);
        const controller = new AbortController();
        const pending = client.runSqlScript("SELECT pg_sleep(30)", { signal: controller.signal });
        await Promise.resolve();
        const run = frames(ws).find((frame) => frame.type === "EXECUTE_SQL")!;
        expect(run.payload).toEqual({ sql: "SELECT pg_sleep(30)", options: {}, mode: "script" });

        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        await Promise.resolve();
        expect(frames(ws)).toContainEqual(expect.objectContaining({ type: "CANCEL_SQL", payload: { requestId: run.requestId } }));

        // The run's own late answer lands on nobody.
        ws.onmessage!({ data: JSON.stringify({ type: "ERROR", requestId: run.requestId, payload: { error: { message: "canceling statement due to user request", code: "SQL_ERROR" } } }) });
    });

    it("sends no CANCEL_SQL to a server that did not say it takes one", async () => {
        const ws = await signedIn();
        const controller = new AbortController();
        const pending = client.runSqlScript("SELECT pg_sleep(30)", { signal: controller.signal });
        await Promise.resolve();
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        await Promise.resolve();
        expect(frames(ws).map((frame) => frame.type)).not.toContain("CANCEL_SQL");
    });

    it("sends nothing for a signal aborted before the run", async () => {
        const ws = await signedIn(["cancel_sql"]);
        const controller = new AbortController();
        controller.abort();
        await expect(client.runSqlScript("DELETE FROM posts", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        await Promise.resolve();
        expect(frames(ws).map((frame) => frame.type)).not.toContain("EXECUTE_SQL");
    });

    it("resolves as before when the run ends first", async () => {
        const ws = await signedIn(["cancel_sql"]);
        const controller = new AbortController();
        const pending = client.runSqlScript("SELECT 1 AS one", { signal: controller.signal });
        await Promise.resolve();
        const run = frames(ws).find((frame) => frame.type === "EXECUTE_SQL")!;
        ws.onmessage!({ data: JSON.stringify({ type: "EXECUTE_SQL_SUCCESS", requestId: run.requestId, payload: { result: [{ one: "1" }], columns: [{ name: "one" }], tables: [] } }) });
        await expect(pending).resolves.toMatchObject({ rows: [{ one: "1" }] });
        controller.abort();
        await Promise.resolve();
        expect(frames(ws).map((frame) => frame.type)).not.toContain("CANCEL_SQL");
    });
});
