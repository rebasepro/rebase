import { CollectionConfig } from "@rebasepro/types";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * The related-rows path — `fetchCollection("posts/1/comments")` — flattens the
 * `RelatedRow` objects RelationService returns into plain rows.
 *
 * It used to spread the target's synthesized string address in last, which
 * overwrote a real `id` column with a restringified copy of itself (or, for a
 * target keyed on something else, with a value from a different column
 * entirely). The rows are the target's columns now; a consumer that needs the
 * address resolves the path to the target collection and derives it.
 */
describe("related rows via path — the target's columns, and only those", () => {
    const registry = new PostgresCollectionRegistry();

    const commentsCollection: CollectionConfig = {
        slug: "comments",
        name: "Comments",
        table: "comments",
        properties: {
            id: { type: "number",
isId: "increment" },
            body: { type: "string" }
        },
        idField: "id"
    };

    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number",
isId: "increment" },
            comments: { type: "relation",
relationName: "comments" }
        },
        relations: [
            {
                relationName: "comments",
                target: () => commentsCollection,
                cardinality: "many",
                direction: "inverse",
                foreignKeyOnTarget: "post_id"
            }
        ],
        idField: "id"
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
            path.startsWith("posts") ? postsCollection : commentsCollection);
    });

    it("returns the related rows' own columns, with their real types", async () => {
        const fetchService = new FetchService({} as any, registry);
        jest.spyOn(fetchService.getRelationService(), "fetchRelatedEntities").mockResolvedValue([
            { id: "5",
path: "comments",
values: { id: 5,
body: "First!" } },
            { id: "6",
path: "comments",
values: { id: 6,
body: "Second." } }
        ]);

        const rows = await fetchService.fetchCollection("posts/1/comments", {});

        // Not `id: "5"` — the integer column, unrestringified and unoverwritten.
        expect(rows).toEqual([
            { id: 5,
body: "First!" },
            { id: 6,
body: "Second." }
        ]);
    });
});
