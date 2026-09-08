import { CollectionConfig } from "@rebasepro/types";
import { Table } from "drizzle-orm";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * One query, one row shape — whichever entry point asks.
 *
 * `find()`, `findById()` and the realtime refetch used to be three different
 * pipelines over the same data:
 *
 *  - the REST list took Drizzle's relational query API (`findMany({ with })`),
 *    which compiles a to-many relation into a lateral join;
 *  - the REST get-by-id took `findFirst({ with })` with a hand-written N+1
 *    fallback beneath it, and the two disagreed about a to-one relation that
 *    resolves to nothing — absent on one, `null` on the other;
 *  - the realtime refetch went through `fetchCollection`, which passed no
 *    `include` at all and therefore loaded EVERY relation the collection
 *    declares, under a `{ __type: "relation" }` envelope.
 *
 * So a subscriber and a fetcher, asking the identical question, were handed
 * rows of different shapes — and the generated types described only one of the
 * three. There is one pipeline now, and these assert that the three entry
 * points come out of it identical, with an `include` and without one.
 */
describe("read-shape parity across the entry points", () => {
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: string[]) => {
        const t: Record<string, unknown> = { [Table.Symbol.Name]: name };
        const cols: Record<string, unknown> = {};
        for (const c of columns) {
            const column = { name: c, getSQLType: () => "text" };
            t[c] = column;
            cols[c] = column;
        }
        t[Table.Symbol.Columns] = cols;
        return t;
    };

    const authorsCollection: CollectionConfig = {
        slug: "authors",
        name: "Authors",
        table: "authors",
        properties: {
            id: { type: "number", isId: true },
            name: { type: "string" }
        },
        idField: "id"
    } as unknown as CollectionConfig;

    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number", isId: true },
            title: { type: "string" },
            author: { type: "relation", relationName: "author" }
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
    } as unknown as CollectionConfig;

    const POST = { id: 1, title: "Hello", author_id: 7 };
    const AUTHOR = { id: 7, name: "Ada" };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path === "posts") return postsCollection;
            if (path === "authors") return authorsCollection;
            return undefined;
        });
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "posts") return table("posts", ["id", "title", "author_id"]) as never;
            if (name === "authors") return table("authors", ["id", "name"]) as never;
            return undefined;
        });
    });

    /**
     * A FetchService whose base read returns `POST` and whose relation batch
     * returns `AUTHOR` — the same underlying data for every entry point, so any
     * difference in the rows they produce is the pipeline's and not the
     * fixture's.
     */
    const service = () => {
        const chain: Record<string, unknown> = {};
        Object.assign(chain, {
            from: jest.fn(() => chain),
            $dynamic: jest.fn(() => chain),
            where: jest.fn(() => chain),
            orderBy: jest.fn(() => chain),
            offset: jest.fn(() => chain),
            // The list path leaves the chain thenable; the single-row path ends
            // on `.limit(1)` and awaits that.
            limit: jest.fn(() => chain),
            then: (resolve: (rows: unknown) => void) => resolve([POST])
        });
        const db = {
            select: jest.fn(() => chain),
            selectDistinct: jest.fn(() => chain)
        };
        const fetchService = new FetchService(db as never, registry);
        const relations = (fetchService as never as { relationService: Record<string, unknown> }).relationService;
        relations.batchFetchRelatedEntities = jest.fn().mockResolvedValue(
            new Map([["1", { id: 7, path: "authors", values: AUTHOR }]])
        );
        relations.batchFetchRelatedEntitiesMany = jest.fn().mockResolvedValue(new Map());
        return fetchService;
    };

    /**
     * The three entry points, over one query.
     *
     * The realtime refetch is `fetchCollectionForRest` — that is the change:
     * it used to be `fetchCollection`, whose rows are the admin's view model.
     */
    const readAllThree = async (include?: string[]) => {
        const list = await service().fetchCollectionForRest("posts", {}, include);
        const one = await service().fetchOneForRest("posts", 1, include);
        const live = await service().fetchCollectionForRest("posts", {}, include);
        return { list: list[0], one, live: live[0] };
    };

    it("returns the same row from all three, with no include", async () => {
        const { list, one, live } = await readAllThree();

        expect(one).toEqual(list);
        expect(live).toEqual(list);
        // The foreign key, and no relation nested over it.
        expect(list).toMatchObject({ id: 1, title: "Hello" });
        expect(list).not.toHaveProperty("author.name");
    });

    it("returns the same row from all three, with an include", async () => {
        const { list, one, live } = await readAllThree(["author"]);

        expect(one).toEqual(list);
        expect(live).toEqual(list);
        // The target's own columns, inlined — not a `{ __type: "relation" }`
        // envelope, which is the admin's view model and never reaches a
        // developer's `find()`.
        expect(list).toMatchObject({ id: 1, author: { id: 7, name: "Ada" } });
        expect(list).not.toHaveProperty("author.__type");
    });

    it("gives every entry point the same key set", async () => {
        const withInclude = await readAllThree(["author"]);
        const without = await readAllThree();

        const keys = (row: unknown) => Object.keys(row as Record<string, unknown>).sort();

        expect(keys(withInclude.one)).toEqual(keys(withInclude.list));
        expect(keys(withInclude.live)).toEqual(keys(withInclude.list));
        expect(keys(without.one)).toEqual(keys(without.list));
        // And the include is the only thing that changes them.
        expect(keys(withInclude.list)).toEqual([...keys(without.list), "author"].sort());
    });

    it("refuses an unknown relation identically on all three", async () => {
        // Silently ignoring it answers 200 with the field missing, which reads
        // exactly like a row that has no related row — so a typo in an
        // `include` looked like empty data.
        await expect(service().fetchCollectionForRest("posts", {}, ["authr"]))
            .rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
        await expect(service().fetchOneForRest("posts", 1, ["authr"]))
            .rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
    });
});
