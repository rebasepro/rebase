import { CollectionConfig } from "@rebasepro/types";

/**
 * `afterRead` is where PII masking lives, and the raw fetch service does not run
 * callbacks — so the REST/SDK path applies them itself, including one level into
 * embedded relations (so `post.author.email` is masked by the *authors*
 * collection, not served raw).
 *
 * The failure mode is silence: a mask that inspects the wrong shape finds no
 * `email` to redact, redacts nothing, and returns 200. Nothing throws, and no
 * existing test covers it — which is the entire reason to pin it here.
 */
describe("REST afterRead — masking reaches embedded relations", () => {

    const authorsCollection: CollectionConfig = {
        slug: "authors",
        name: "Authors",
        table: "authors",
        properties: {
            id: { type: "number",
isId: "increment" },
            name: { type: "string" },
            email: { type: "string" }
        },
        callbacks: {
            afterRead: ({ row }) => ({ ...row,
email: "***" })
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
            title: { type: "string" },
            author: { type: "relation",
relationName: "author" }
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "author",
                target: () => authorsCollection,
                localKey: "author_id"
            }
        ],
        idField: "id"
    };

    /**
     * Drive the real pipeline through a driver whose fetch service is stubbed,
     * so this exercises `applyAfterReadForRest` itself rather than a copy of it.
     */
    const runRest = async (rows: Record<string, unknown>[]) => {
        const { PostgresBackendDriver } = await import("../src/PostgresBackendDriver");

        const registry = {
            getCollectionByPath: (path: string) =>
                path.startsWith("authors") ? authorsCollection : postsCollection,
            getCollections: () => [postsCollection, authorsCollection],
            getGlobalCallbacks: () => undefined
        };

        const driver = Object.create(PostgresBackendDriver.prototype) as any;
        driver.registry = registry;
        driver.collectionRegistry = registry;
        driver.dataService = {
            getFetchService: () => ({
                fetchCollectionForRest: async () => rows
            })
        };
        driver.buildCallContext = () => ({ user: undefined });

        return driver.applyAfterReadForRest(rows, "posts");
    };

    it("masks an embedded relation served as a flat inlined row", async () => {
        // This is the shape REST serves: the target's columns, inlined.
        const [post] = await runRest([
            { id: 1,
title: "Hello",
author: { id: 10,
name: "Ada",
email: "ada@example.com" } }
        ]);

        expect((post.author as Record<string, unknown>).email).toBe("***");
        expect((post.author as Record<string, unknown>).name).toBe("Ada");
    });

    it("leaves a row without the relation untouched", async () => {
        const [post] = await runRest([{ id: 2,
title: "No author",
author: null }]);

        expect(post.author).toBeNull();
        expect(post.title).toBe("No author");
    });

    it("masks every element of a many relation", async () => {
        const [post] = await runRest([
            {
                id: 3,
                title: "Many",
                author: [
                    { id: 10,
name: "Ada",
email: "ada@example.com" },
                    { id: 11,
name: "Grace",
email: "grace@example.com" }
                ]
            }
        ]);

        const authors = post.author as Record<string, unknown>[];
        expect(authors.map(a => a.email)).toEqual(["***", "***"]);
    });
});
