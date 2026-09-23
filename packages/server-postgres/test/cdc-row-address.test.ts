/**
 * A change captured by the database reaches the single-row subscribers of the
 * row it changed.
 *
 * The trigger captures a row keyed by *column*, and the address was derived
 * from it by *property* key. A key declared as `userId` over `user_id` was
 * therefore never found on the captured row, the address fell back to `*`, and
 * every external write — psql, a cron in another service, the SQL editor —
 * reached collection subscribers and no single-row subscriber at all. The same
 * happened to any row wide enough to overflow `pg_notify`'s 8000-byte cap,
 * whose payload kept `id` alone: a table keyed on anything else lost its
 * address entirely.
 */
import { PGlite } from "@electric-sql/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";

import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { buildCdcFunctionSql, buildCdcTriggerSql } from "../src/services/cdc/trigger-cdc";
import { parseCdcPayload } from "../src/services/cdc/CdcListener";

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest: jest.fn().mockResolvedValue([]),
        fetchOneForRest: jest.fn().mockResolvedValue({ role: "owner" }),
        count: jest.fn().mockResolvedValue(0),
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

class MockWebSocket {
    public readyState = 1;
    public send = jest.fn();
    public on = jest.fn();
}

const members: CollectionConfig = {
    slug: "members",
    name: "Members",
    table: "members",
    properties: {
        projectId: { type: "string", isId: true, columnName: "project_id" },
        userId: { type: "string", isId: true, columnName: "user_id" },
        role: { type: "string" }
    }
};

const docs: CollectionConfig = {
    slug: "docs",
    name: "Docs",
    table: "docs",
    properties: {
        docId: { type: "number", isId: "increment", columnName: "doc_id" },
        body: { type: "string" }
    }
};

describe("the address of a captured row", () => {
    let realtime: RealtimeService;
    let ws: MockWebSocket;

    beforeEach(async () => {
        jest.useFakeTimers();
        const db = {
            execute: jest.fn().mockResolvedValue({ rows: [] }),
            transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(db))
        } as unknown as NodePgDatabase<Record<string, never>>;
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([members, docs]);
        realtime = new RealtimeService(db, registry);
        // Switched on the way `enableCdc()` would, without a LISTEN connection.
        Reflect.set(realtime, "cdcTableMap", Reflect.apply(Reflect.get(realtime, "buildCdcTableMap"), realtime, []));
        Reflect.set(realtime, "cdcActive", true);

        ws = new MockWebSocket();
        realtime.addClient("client-1", ws as never);
        const one = (path: string, id: string, subscriptionId: string) =>
            realtime.handleClientMessage("client-1", { type: "subscribe_one", payload: { path, id, subscriptionId } });
        await one("members", "p1:::bob", "bob");
        await one("members", "p1:::alice", "alice");
        await one("docs", "5", "doc-5");
        ws.send.mockClear();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    async function captured(table: string, row: Record<string, unknown>): Promise<string[]> {
        await Reflect.apply(Reflect.get(realtime, "handleCdcEvent"), realtime, [
            { schema: "public", table, op: "UPDATE", row }
        ]);
        jest.advanceTimersByTime(350);
        for (let i = 0; i < 20; i++) await Promise.resolve();
        return [...new Set(ws.send.mock.calls
            .map((call: unknown[]) => JSON.parse(String(call[0])) as { subscriptionId?: string })
            .map(frame => frame.subscriptionId)
            .filter((id): id is string => id !== undefined))].sort();
    }

    it("is read from the key's columns, for a composite key", async () => {
        expect(await captured("members", { project_id: "p1", user_id: "bob", role: "owner" })).toEqual(["bob"]);
    });

    it("is read from the key's column, for a single key named apart from it", async () => {
        expect(await captured("docs", { doc_id: 5, body: "x" })).toEqual(["doc-5"]);
    });
});

describe("the payload of a row too wide for pg_notify", () => {
    let db: PGlite;

    afterEach(async () => {
        await db.close();
    });

    it("keeps every primary-key column, so the row can still be addressed", async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(`
            CREATE TABLE members (project_id varchar, user_id varchar, bio text, PRIMARY KEY (project_id, user_id));
            ${buildCdcFunctionSql()}
            ${buildCdcTriggerSql("public", "members")}
        `);
        const payloads: string[] = [];
        await db.listen("rebase_cdc", payload => { payloads.push(payload); });

        await db.query("INSERT INTO members VALUES ('p1', 'bob', $1)", ["x".repeat(9000)]);
        for (let i = 0; i < 50 && payloads.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));

        const event = parseCdcPayload(payloads[0]);
        expect(event?.truncated).toBe(true);
        expect(event?.row).toEqual({ project_id: "p1", user_id: "bob" });
    });
});
