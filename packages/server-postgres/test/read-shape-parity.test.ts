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
            name: { type: "string" },
            joined_at: { type: "date" }
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
            published_at: { type: "date" },
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

    // The timestamp exactly as node-postgres hands it over: a Postgres literal,
    // with a space and a two-digit offset. Not ISO, and not a `Date`.
    const POST = { id: 1, title: "Hello", published_at: "2026-08-24 01:37:57.647+02", author_id: 7 };
    const AUTHOR = { id: 7, name: "Ada", joined_at: "2020-01-02 04:04:05+01" };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path === "posts") return postsCollection;
            if (path === "authors") return authorsCollection;
            return undefined;
        });
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "posts") return table("posts", ["id", "title", "published_at", "author_id"]) as never;
            if (name === "authors") return table("authors", ["id", "name", "joined_at"]) as never;
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
     * The three DEVELOPER entry points, over one query: `find()`, `findById()`
     * and the in-process `listen()`. All three take `fetchCollectionForRest`
     * in its default rendering, and these assert they agree.
     *
     * The panel's wire is the fourth entry point and it does NOT belong in this
     * set — see the block below.
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

    /**
     * One shape, for every consumer — the property that broke on 2026-09-09 and
     * that nothing here asserted.
     *
     * The realtime refetch was unified onto this rendering so `find()` and
     * `listen()` would agree. They did. But the admin panel is a subscriber on
     * that wire and had always been served a *second* shape — relations as
     * `{ __type: "relation" }` refs, dates as `{ __type: "date" }` envelopes —
     * so every date cell in the panel began reading "Invalid date value" and
     * every relation cell "Unexpected value", on the public demo, with all
     * 2,891 tests green. The tests asserted the arguments the refetch was
     * called with and the row a developer gets; nothing asserted what any
     * consumer is actually handed.
     *
     * The panel builds its own view model now (`toViewModelValues` in
     * `@rebasepro/common`), so these assert the only thing the wire owes it: one
     * rendering, and values a browser can parse.
     */
    describe("one rendering, and the types the spec promises", () => {
        it("serves a relation as the target's own columns, never an envelope", async () => {
            const [row] = await service().fetchCollectionForRest("posts", {}, ["author"]);

            expect(row.author).toMatchObject({ id: 7, name: "Ada" });
            expect(row.author).not.toHaveProperty("__type");
        });

        it("serves a date as RFC 3339, which is what the OpenAPI document says", async () => {
            const [row] = await service().fetchCollectionForRest("posts", {}, ["author"]);

            // Not `"2026-08-24 01:37:57.647+02"` — the Postgres literal, which
            // V8 parses by accident and Safari need not parse at all.
            expect(row.published_at).toBe("2026-08-23T23:37:57.647Z");
        });

        it("renders an included target exactly as it renders its parent", async () => {
            const [row] = await service().fetchCollectionForRest("posts", {}, ["author"]);
            const author = row.author as Record<string, unknown>;

            // The bug this catches: the parent's dates rendered by `toRestRow`
            // and the child's left in the relation walk's own types, so one
            // response carried a date column in two encodings.
            expect(author.joined_at).toBe("2020-01-02T03:04:05.000Z");
            expect(typeof author.joined_at).toBe(typeof row.published_at);
        });
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
