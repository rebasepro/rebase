import { CollectionConfig } from "@rebasepro/types";
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

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
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) t[c] = { name: c };
        return t;
    };

    // A string-keyed target: the shape whose failure was silent.
    const tagsCollection: CollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        properties: {
            id: { type: "string", isId: true },
            name: { type: "string" }
        }
    } as unknown as CollectionConfig;

    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "string", isId: true },
            title: { type: "string" },
            tags: { type: "relation", relationName: "tags" }
        },
        relations: [
            {
                kind: "manyToMany",
                relationName: "tags",
                target: () => tagsCollection,
                cardinality: "many",
                through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }
        ]
    } as unknown as CollectionConfig;

    /**
     * A tx that records what was inserted into the junction. `existing` is what
     * the writer's own "what is linked now?" select answers with — it diffs
     * against that rather than replacing the set. See junction-diff-write.
     */
    const recordingTx = (existing: (string | number)[] = []) => {
        const inserted: Record<string, unknown>[][] = [];
        const tx = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(async () => existing.map(id => ({ targetId: id })))
                }))
            })),
            // `rowCount` matters: the writer compares it against how many links
            // it named, and a delete that reports nothing removed is treated as
            // a policy refusal. See junction-diff-write.
            delete: jest.fn(() => ({ where: jest.fn(async () => ({ rowCount: existing.length })) })),
            insert: jest.fn(() => ({
                values: jest.fn((rows: Record<string, unknown>[]) => {
                    inserted.push(rows);
                    return { onConflictDoNothing: jest.fn(async () => undefined) };
                })
            }))
        };
        return { tx, inserted };
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "posts") return table("posts", ["id", "title"]) as never;
            if (name === "tags") return table("tags", ["id", "name"]) as never;
            if (name === "posts_tags") return table("posts_tags", ["post_id", "tag_id"]) as never;
            return undefined;
        });
    });

    const writeTags = async (value: unknown) => {
        const { tx, inserted } = recordingTx();
        const service = new RelationService({} as never, registry);
        await service.updateRelationsUsingJoins(tx as never, postsCollection, "p1", { tags: value } as never);
        return inserted;
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
        const { tx, inserted } = recordingTx(["t-1", "t-2"]);
        const service = new RelationService({} as never, registry);
        await service.updateRelationsUsingJoins(tx as never, postsCollection, "p1", { tags: [] } as never);

        expect(tx.delete).toHaveBeenCalled();
        expect(inserted).toEqual([]);
    });
});
