import { CollectionConfig } from "@rebasepro/types";
import { integer, pgTable, varchar } from "drizzle-orm/pg-core";
import { RelationService } from "../src/services/RelationService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import * as transformer from "../src/data-transformer";
import { arrayRowsFor, recordingDb } from "./helpers/spg-b-recording-db";

/**
 * An `include` renders each related row once, as its own REST route would.
 *
 * It used to render it twice: first as the admin's view model
 * (`parseDataFromServer`, which also minted a `{ __type: "relation" }` ref for
 * the target's own to-one relations), then again for REST. The second pass did
 * not undo the first's ref, so `post.comments[0].post` came back as an
 * envelope the REST contract says a developer never sees — and every related
 * row cost 2.5× a parent row. Counted, not timed: the admin rendering must not
 * run at all on the REST path, and must still run on the admin's.
 */
describe("the include loader renders a related row once", () => {
    const registry = new FixtureTableRegistry();

    const postsTable = pgTable("posts", { id: integer("id").primaryKey(), title: varchar("title") });
    const commentsTable = pgTable("comments", {
        id: integer("id").primaryKey(),
        body: varchar("body"),
        postId: integer("post_id")
    });

    const commentsCollection: CollectionConfig = {
        slug: "comments", name: "Comments", table: "comments",
        properties: {
            id: { type: "number", isId: "increment" },
            body: { type: "string" },
            post: { type: "relation", relation: { kind: "belongsTo", target: () => postsCollection, localKey: "post_id" } }
        }
    };

    const postsCollection: CollectionConfig = {
        slug: "posts", name: "Posts", table: "posts",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" },
            comments: { type: "relation", relation: { kind: "hasMany", target: () => commentsCollection, foreignKeyOnTarget: "post_id" } }
        }
    };

    const COMMENTS = 50;
    const commentRows = Array.from({ length: COMMENTS }, (_, i) => ({ id: i + 1, body: `c${i}`, postId: 1 + (i % 2) }));

    /** A database whose every select answers the comment rows, by column. */
    const db = () => recordingDb(({ text }) =>
        (/^\s*select\b/i.test(text) ? arrayRowsFor(text, commentRows.map(({ postId, ...row }) => ({ ...row, post_id: postId }))) : [])).db;

    registry.registerPgTable(postsTable, "posts");
    registry.registerPgTable(commentsTable, "comments");

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path === "posts" ? postsCollection : commentsCollection);
    });

    const relation = () => Object.values(
        // Resolved the way the loader resolves it.
        jest.requireActual<typeof import("@rebasepro/common")>("@rebasepro/common").resolveCollectionRelations(postsCollection)
    )[0];

    it("does not build the admin view model for a REST include", async () => {
        const parse = jest.spyOn(transformer, "parseDataFromServer");
        const service = new RelationService(db(), registry);

        const related = await service.batchFetchRelatedEntitiesMany(
            "posts", [1, 2], "comments", relation(), undefined, undefined, { style: "rest" }
        );

        expect(parse).not.toHaveBeenCalled();
        const rows = [...related.values()].flat();
        expect(rows).toHaveLength(COMMENTS);
        // The target's own row: its foreign key as the column, no ref minted
        // for its `post` relation.
        expect(rows[0].values).toEqual({ id: 1, body: "c0", postId: 1 });
    });

    it("still builds it, once a row, for the admin", async () => {
        const parse = jest.spyOn(transformer, "parseDataFromServer");
        const service = new RelationService(db(), registry);

        await service.batchFetchRelatedEntitiesMany("posts", [1, 2], "comments", relation());

        expect(parse).toHaveBeenCalledTimes(COMMENTS);
    });
});
