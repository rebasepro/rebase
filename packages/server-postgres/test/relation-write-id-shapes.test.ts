import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { RelationService } from "../src/services/RelationService";
import { RelationWriteService } from "../src/services/RelationWriteService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { insertedRows, recordingDb, shapedRows, unusedDb } from "./helpers/spg-c-db";
import { textTable } from "./helpers/spg-c-tables";

/**
 * A membership list can be written as rows or as keys, and both have to land.
 *
 * `POST /api/data/posts { tags: [1] }` is the obvious way to write a
 * many-to-many by hand; `{ tags: [{ id: 1 }] }` is what a client sends back
 * after reading the related rows. The junction writer read only the second,
 * through a blind `.map(rel => rel.id)`.
 *
 * What that cost depended entirely on the target's key type, which is the worst
 * property a bug can have:
 *
 *   - numeric key → `parseIdValues(undefined)` threw `Invalid numeric ID:
 *     undefined`, a message naming neither the collection nor the relation.
 *   - string key  → no error at all. `String(undefined)` is `"undefined"`, so
 *     the junction took a row pointing at a target that cannot exist. The write
 *     answered 201 and the edge was never readable.
 *
 * A third writer (the `via` inverse path) already handled both shapes, so the
 * same request behaved differently depending on how the relation was declared.
 * These pin all of it.
 */
describe("relation writes accept rows or bare keys", () => {
    const registry = new FixtureTableRegistry();


    // A string-keyed target: the shape whose failure was silent.
    const tagsCollection: LegacyCollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        properties: {
            id: { type: "string", isId: true },
            name: { type: "string" }
        }
    };

    const postsCollection: LegacyCollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "string", isId: true },
            title: { type: "string" },
            tags: { type: "relation", relation: { kind: "manyToMany", relationName: "tags", target: () => tagsCollection, through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } } }
        }
    };
    registry.registerMultiple([postsCollection, tagsCollection]);

    /**
     * A tx that records what was inserted into the junction. `existing` is what
     * the writer's own "what is linked now?" select answers with — it diffs
     * against that rather than replacing the set. See junction-diff-write.
     */
    const recordingTx = (existing: (string | number)[] = []) => {
        // The writer's "what is linked now?" read answers `existing`; a delete
        // reports as many rows removed as were linked, as Postgres would.
        const { db: tx, statements } = recordingDb((statement) => {
            if (/^select /i.test(statement.text)) return shapedRows(statement, existing.map(id => ({ tag_id: id })));
            if (/^delete /i.test(statement.text)) return existing.map(id => ({ tag_id: id }));
            return [];
        });
        const inserts = () => statements.filter(s => /^insert into "posts_tags"/i.test(s.text));
        return {
            tx,
            deleted: () => statements.some(s => /^delete from "posts_tags"/i.test(s.text)),
            inserted: () => inserts().map(insertedRows)
        };
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getPgTable").mockImplementation(name => {
            if (name === "posts") return textTable("posts", ["id", "title"]);
            if (name === "tags") return textTable("tags", ["id", "name"]);
            if (name === "posts_tags") return textTable("posts_tags", ["post_id", "tag_id"]);
            return undefined;
        });
    });

    const writeTags = async (value: unknown) => {
        const { tx, inserted } = recordingTx();
        const service = new RelationWriteService(unusedDb(), registry);
        await service.updateRelationsUsingJoins(tx, postsCollection, "p1", { tags: value });
        return inserted();
    };

    it("writes a junction row from a bare key", async () => {
        const inserted = await writeTags(["t-1", "t-2"]);
        expect(inserted[0]).toEqual([
            { post_id: "p1", tag_id: "t-1" },
            { post_id: "p1", tag_id: "t-2" }
        ]);
    });

    it("writes the same junction row from a related row object", async () => {
        const inserted = await writeTags([{ id: "t-1", name: "One" }]);
        expect(inserted[0]).toEqual([{ post_id: "p1", tag_id: "t-1" }]);
    });

    it("never writes the string \"undefined\" as a key", async () => {
        // The regression itself: this is what a bare key used to become on a
        // string-keyed target, with no error anywhere.
        const inserted = await writeTags(["t-1"]);
        const keys = inserted.flat().map(row => row.tag_id);
        expect(keys).not.toContain("undefined");
        expect(keys).toEqual(["t-1"]);
    });

    it("refuses an element that carries no key, naming the relation", async () => {
        // Skipping it would write a shorter membership list than asked for,
        // which reads as a successful write of the wrong thing.
        await expect(writeTags([{ name: "no id here" }])).rejects.toThrow(
            /relation "tags" on "posts".*element 0 carries no id/s
        );
        await expect(writeTags([null])).rejects.toThrow(/carries no id/);
    });

    it("clears the membership when given an empty list", async () => {
        const { tx, deleted, inserted } = recordingTx(["t-1", "t-2"]);
        const service = new RelationWriteService(unusedDb(), registry);
        await service.updateRelationsUsingJoins(tx, postsCollection, "p1", { tags: [] });

        expect(deleted()).toBe(true);
        expect(inserted()).toEqual([]);
    });
});
