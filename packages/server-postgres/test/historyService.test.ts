import { HistoryService, findChangedFields } from "../src/history/HistoryService";
import { recordingDb, type RecordedQuery } from "./helpers/spg-b-recording-db";

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
            const result = findChangedFields(oldValues, newValues);
            expect(result).toEqual(["tags"]);
        });
    });

    describe("recordHistory execution mapping", () => {
        // The statements pg is sent: their text and bound values, which are
        // all the database ever sees of a drizzle query.
        let queries: RecordedQuery[];
        let historyService: HistoryService;

        beforeEach(() => {
            const recording = recordingDb();
            queries = recording.queries;
            historyService = new HistoryService(recording.db);
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
            expect(queries).toEqual([]);
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
            expect(queries.length).toBeGreaterThanOrEqual(1);

            // The syntax we added is ARRAY[?]::text[] or similar
            expect(queries[0].text).toContain("::text[]");
            expect(queries[0].text).toContain("ARRAY[");
        });

        // Calls 2026-10-12 (P7, DD-4c): a snapshot never holds a related
        // row's values — whoever may read `posts` history must not read
        // `authors` columns out of it. The driver records the stored row read
        // back without `include` (a relation as its foreign key), and the
        // service stores exactly that; an old entry holding the admin's
        // relation refs is reduced to keys when served (history-routes).
        it("stores the row it is given — wire values, a relation as its foreign key", async () => {
            await historyService.recordHistory({
                tableName: "posts",
                id: "1",
                action: "delete",
                values: { title: "Hello", authorId: 7, publishedAt: "2026-01-02T03:04:05.000Z", meta: { tags: ["t1"] } }
            });

            const stored = JSON.parse(String(queries[0].values[3]));
            expect(stored).toEqual({ title: "Hello", authorId: 7, publishedAt: "2026-01-02T03:04:05.000Z", meta: { tags: ["t1"] } });
        });

        it("should properly perform query during entity creation (insert)", async () => {
            await historyService.recordHistory({
                tableName: "posts",
                // @ts-expect-error a numeric id from an untyped caller: the service binds it as text regardless.
                id: 1,
                action: "create",
                previousValues: undefined,
                values: { title: "new" },
                updatedBy: "user-9"
            });

            // The first statement is the INSERT; whatever follows is the prune
            // pass, which is fire-and-forget and says nothing about what was
            // recorded.
            const { text, values: params } = queries[0];

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
