import type { CollectionConfig } from "@rebasepro/types";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { FetchService } from "../src/services/FetchService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { recordingDb, shapedRows } from "./helpers/spg-c-db";

/**
 * A related listing — `fetchCollection("posts/1/comments")` — serves the
 * target's own columns, with their real types.
 *
 * It used to run through a separate builder that returned `RelatedRow` wrappers
 * and then flattened them, spreading the target's synthesized *string* address
 * in last: that overwrote a real `id` column with a restringified copy of
 * itself, or — for a target keyed on something else — with a value from a
 * different column entirely.
 *
 * A related listing is now the ordinary collection query narrowed by one
 * condition, so there is no wrapper to flatten and no address to spread. This
 * pins the property that used to be a bug: what comes back is columns.
 */
describe("related rows via path — the target's columns, and only those", () => {
    const registry = new FixtureTableRegistry();

    const commentsCollection: CollectionConfig = {
        slug: "comments",
        name: "Comments",
        table: "comments",
        properties: {
            id: { type: "number",
isId: "increment" },
            body: { type: "string" }
        }
    };

    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number",
isId: "increment" },
            comments: { type: "relation", relation: { kind: "hasMany", relationName: "comments", target: () => commentsCollection, foreignKeyOnTarget: "post_id" } }
        }
    };

    const commentsTable = pgTable("comments", { id: integer("id").primaryKey(), body: text("body"), postId: integer("post_id") });

    /** The rows Postgres hands back, before anything in the service sees them. */
    const dbRows = [
        { id: 5, body: "First!", post_id: 1 },
        { id: 6, body: "Second.", post_id: 1 }
    ];

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("posts") ? postsCollection : commentsCollection);
        jest.spyOn(registry, "getPgTable").mockImplementation(tableName =>
            tableName === "comments" ? commentsTable : undefined);
    });

    it("returns the related rows' own columns, with their real types", async () => {
        const { db } = recordingDb((statement) => shapedRows(statement, dbRows));

        const fetchService = new FetchService(db, registry);
        const rows = await fetchService.fetchCollection("posts/1/comments", {});

        // Not `id: "5"` — the integer column, unrestringified and unoverwritten.
        // `post_id` is absent because the collection does not declare it; the
        // point here is the columns it *does* declare, and their types.
        expect(rows).toEqual([
            { id: 5,
body: "First!" },
            { id: 6,
body: "Second." }
        ]);
    });
});
