import { HistoryService, findChangedFields } from "../src/history/HistoryService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleClient } from "../src/interfaces";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * Render a drizzle `SQL` the way the driver would.
 *
 * The statement and its bound parameters are the only thing the database ever
 * sees; the builder object around them is drizzle's business. Rendering with
 * drizzle's own dialect keeps the assertions on the former.
 */
function renderSql(query: unknown): { text: string; params: unknown[] } {
    const { sql: text, params } = new PgDialect().sqlToQuery(query as SQL);
    return { text,
params };
}

describe("HistoryService - changedFields and history insertion logic", () => {
    describe("findChangedFields", () => {
        it("should return null when identical flat objects are compared", () => {
            const oldValues = { title: "Hello",
description: "World" };
            const newValues = { title: "Hello",
description: "World" };
            const result = findChangedFields(oldValues, newValues);
            expect(result).toBeNull();
        });

        it("should detect changes on simple properties", () => {
            const oldValues = { title: "Hello" };
            const newValues = { title: "Hello World" };
            const result = findChangedFields(oldValues, newValues);
            expect(result).toEqual(["title"]);
        });

        it("should skip properties starting with double underscore", () => {
            const oldValues = { title: "Hello",
__internal: 123 };
            const newValues = { title: "Hello",
__internal: 456 };
            const result = findChangedFields(oldValues, newValues);
            expect(result).toBeNull();
        });

        it("should return null for deeply identical relations", () => {
            const oldValues = {
                author: { id: "1",
path: "authors",
__type: "relation" },
                tags: [{ id: "1" }, { id: "2" }]
            };
            const newValues = {
                author: { id: "1",
path: "authors",
__type: "relation" },
                tags: [{ id: "1" }, { id: "2" }]
            };
            const result = findChangedFields(oldValues as Record<string, unknown>, newValues as Record<string, unknown>);
            expect(result).toBeNull();
        });

        it("should detect changes in relation properties when IDs differ", () => {
            const oldValues = {
                author: { id: "1",
path: "authors",
__type: "relation" }
            };
            const newValues = {
                author: { id: "2",
path: "authors",
__type: "relation" }
            };
            const result = findChangedFields(oldValues as Record<string, unknown>, newValues as Record<string, unknown>);
            expect(result).toEqual(["author"]);
        });

        it("should detect differences in relation arrays", () => {
            const oldValues = {
                tags: [{ id: "1" }]
            };
            const newValues = {
                tags: [{ id: "1" }, { id: "2" }]
            };
            const result = findChangedFields(oldValues as unknown as Record<string, unknown>, newValues as unknown as Record<string, unknown>);
            expect(result).toEqual(["tags"]);
        });
    });

    describe("recordHistory execution mapping", () => {
        let db: jest.Mocked<NodePgDatabase>;
        let historyService: HistoryService;

        beforeEach(() => {
            db = {
                execute: jest.fn().mockResolvedValue({})
            } as unknown as jest.Mocked<NodePgDatabase>;
            historyService = new HistoryService(db as unknown as DrizzleClient, {} as unknown as PostgresCollectionRegistry);
            jest.spyOn(console, "error").mockImplementation(() => {});
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it("should skip execution when changed fields evaluate to null on update", async () => {
            await historyService.recordHistory({
                tableName: "posts",
                id: "1",
                action: "update",
                previousValues: { title: "same" },
                values: { title: "same" }
            });

            // db.execute should not be called since there is no data to log
            expect(db.execute).not.toHaveBeenCalled();
        });

        it("should properly structure database query on actual array changes", async () => {
            await historyService.recordHistory({
                tableName: "posts",
                id: "1",
                action: "update",
                previousValues: { title: "old",
tags: [{ id: 1 }] },
                values: { title: "new",
tags: [{ id: 2 }] }
            });

            // Since it's a difference, db.execute should be called. (plus 2 prune calls)
            expect(db.execute.mock.calls.length).toBeGreaterThanOrEqual(1);

            const executedSql = db.execute.mock.calls[0][0] as unknown as { query: string; sql?: string; strings?: string[]; values?: unknown[] };

            // Drizzle wraps SQL in its own SQL type which contains sql strings and params.
            const serializedSql = JSON.stringify(executedSql);
            // The syntax we added is ARRAY[?]::text[] or similar
            expect(serializedSql).toContain("::text[]");
            expect(serializedSql).toContain("ARRAY[");
        });

        it("should properly perform query during entity creation (insert)", async () => {
            await historyService.recordHistory({
                tableName: "posts",
                id: 1,
                action: "create",
                previousValues: undefined,
                values: { title: "new" },
                updatedBy: "user-9"
            });

            // The first statement is the INSERT; whatever follows is the prune
            // pass, which is fire-and-forget and says nothing about what was
            // recorded.
            const { text, params } = renderSql(db.execute.mock.calls[0][0]);

            expect(text).toContain("INSERT INTO rebase.entity_history");
            // A create has no previous row to diff, so `changed_fields` is the
            // literal NULL rather than an empty ARRAY[] — an empty array would
            // read back as "nothing changed" and hide the row's own creation.
            expect(text).toContain("NULL");
            expect(text).not.toContain("ARRAY[");
            // The id is bound as text: entity_id is a varchar column, so a
            // numeric id has to be stringified or the insert fails outright.
            expect(params).toEqual([
                "posts",
                "1",
                "create",
                JSON.stringify({ title: "new" }),
                "user-9"
            ]);
        });
    });
});
