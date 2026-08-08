/**
 * A search or vector read must apply the `?or=` / `?and=` group like any other.
 *
 * `fetchCollectionForRest` takes the `db.query` path only when there is neither
 * a `searchString` nor a `vectorSearch`, so *every* search request falls into
 * `fetchRowsWithConditionsRaw` — which applied `relatedTo`, `searchString`,
 * `filter` and the vector threshold, and never read `options.logical`. The group
 * was on the object the whole time; nothing looked at it.
 *
 * Bug class 29: the fallback stubs out a contract the primary honours. The
 * primary path (`buildDrizzleQueryOptions`) applies the group, the sibling
 * `fetchRowsWithConditions` applies it at :866, and the route one hop up carries
 * a comment about having fixed exactly this — "`?or=`/`?and=` were parsed and
 * then dropped right here, so a filtered read returned every row RLS allowed".
 *
 * What made it worse than a dropped filter: `count` *does* apply the group
 * (:1137), so `meta.total` counted the narrow set while `data` carried the wide
 * one, and pagination described a response that did not exist.
 *
 * Asserted on the compiled SQL rather than on returned rows, because a dropped
 * condition produces a perfectly well-formed query — just a wider one.
 */
import { CollectionConfig, LogicalCondition } from "@rebasepro/types";
import { pgTable, serial, text, vector } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { FetchService } from "../src/services/FetchService";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/** The realtime refetch's seam: what it asks the search for is the assertion. */
const searchRows = jest.fn().mockResolvedValue([]);
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(null),
        searchRows: (...args: unknown[]) => searchRows(...args)
    }))
}));

const docs = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: text("title"),
    status: text("status"),
    embedding: vector("embedding", { dimensions: 3 })
});

const docsCollection: CollectionConfig = {
    slug: "docs",
    name: "Docs",
    table: "docs",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" },
        status: { type: "string" },
        embedding: { type: "vector", dimensions: 3 }
    },
    idField: "id"
};

const group: LogicalCondition = {
    type: "or",
    conditions: [
        { column: "status", operator: "==", value: "published" },
        { column: "title", operator: "==", value: "pinned" }
    ]
};

/** A FetchService over a proxy driver that records the SQL it is handed. */
const setup = () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const db = drizzle(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [] };
    });

    const registry = new PostgresCollectionRegistry();
    jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
        path === "docs" ? docsCollection : undefined
    );
    jest.spyOn(registry, "getTable").mockImplementation(name =>
        name === "docs" ? (docs as never) : undefined
    );

    return { service: new FetchService(db as never, registry), queries };
};

describe("the `or`/`and` group survives a search", () => {
    it("narrows a searched listing", async () => {
        const { service, queries } = setup();

        await service.fetchCollectionForRest("docs", { searchString: "auditor", logical: group });

        expect(queries).toHaveLength(1);
        // Both halves of the disjunction, and the search predicate they narrow.
        expect(queries[0].sql).toMatch(/ilike/i);
        expect(queries[0].sql).toContain("or");
        expect(queries[0].params).toContain("published");
        expect(queries[0].params).toContain("pinned");
    });

    it("narrows a vector listing", async () => {
        const { service, queries } = setup();

        await service.fetchCollectionForRest("docs", {
            vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3] },
            logical: group
        });

        expect(queries).toHaveLength(1);
        expect(queries[0].sql).toContain("<=>");
        expect(queries[0].params).toContain("published");
        expect(queries[0].params).toContain("pinned");
    });

    it("still combines the group with `filter` using AND, not OR", async () => {
        const { service, queries } = setup();

        await service.fetchCollectionForRest("docs", {
            searchString: "auditor",
            filter: { status: ["==", "draft"] },
            logical: group
        });

        const { sql, params } = queries[0];
        // The group is one parenthesised operand of the top-level AND. If it
        // were merged into the same list as `filter`, `draft` and the two
        // disjuncts would sit at the same level and the read would widen.
        expect(sql).toMatch(/and/i);
        expect(params).toContain("draft");
        expect(params).toContain("published");
    });

    it("leaves a plain listing's SQL alone when no group is sent", async () => {
        const { service, queries } = setup();

        await service.fetchCollectionForRest("docs", { searchString: "auditor" });

        expect(queries[0].params).not.toContain("published");
    });

    it("reaches the search path through `searchRows` too", async () => {
        // The realtime refetch searches through `DataService.searchRows`, whose
        // options type had no `logical` at all — so a live *filtered* search
        // could not pass one on however carefully the subscription stored it.
        const { service, queries } = setup();

        await service.searchRows("docs", "auditor", { logical: group });

        expect(queries[0].params).toContain("published");
    });
});

describe("the same group survives a live search subscription", () => {
    it("is handed to the RLS-bound refetch, not dropped at the branch", async () => {
        const db = {
            execute: jest.fn().mockResolvedValue({ rows: [] }),
            transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
        } as unknown as NodePgDatabase<Record<string, never>>;

        const registry = new PostgresCollectionRegistry();
        jest.spyOn(registry, "getCollectionByPath").mockReturnValue(docsCollection);

        const service = new RealtimeService(
            db, registry, { defaultDatabaseName: "main" } as never, "test-instance",
            { accessTokenSecret: "secret" } as never
        );
        service.addClient("client-1", { readyState: 1, send: jest.fn(), on: jest.fn() } as never);

        await service.handleClientMessage("client-1", {
            type: "subscribe_collection",
            payload: {
                path: "docs", subscriptionId: "sub-1",
                searchString: "auditor", logical: group
            }
        });

        expect(searchRows).toHaveBeenCalledWith(
            "docs", "auditor", expect.objectContaining({ logical: group })
        );
    });
});
