import { describe, expect, it, jest } from "@jest/globals";
import { pgTable, serial, varchar, vector } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";

import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A vector `threshold` narrows the count as well as the listing.
 *
 * `count()` exists so `meta.total` describes the rows that were served. A
 * vector search is the one read where half the parameter matters and half does
 * not: the distance ordering and the `_distance` column change which rows come
 * back first, not how many there are, but `threshold` excludes rows outright.
 * Dropped here, a listing that served three neighbours reported a `total` of
 * every row in the table — and `hasMore` sent the reader into pages the
 * threshold had already emptied.
 *
 * Same recorder as `nested-count-scope.test.ts`: the db answers zero rows and
 * keeps the `where` that was composed, so "was the threshold applied" is a
 * question about the SQL rather than about a database.
 */

const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    embedding: vector("embedding", { dimensions: 3 })
});

const docsCollection = {
    slug: "docs",
    name: "Docs",
    table: "docs",
    idField: "id",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        embedding: { type: "vector", dimensions: 3 }
    }
} as unknown as CollectionConfig;

/** A db that records the `where` a count composed, and answers 0 rows. */
function recordingDb() {
    const seen: { where: unknown } = { where: undefined };
    const chain: Record<string, unknown> = {};
    chain.from = jest.fn(() => chain);
    chain.$dynamic = jest.fn(() => chain);
    chain.where = jest.fn((cond: unknown) => { seen.where = cond; return chain; });
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve([{ count: 0 }]);
    return { db: { select: jest.fn(() => chain) }, seen };
}

function registryFor() {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([docsCollection]);
    registry.registerTable(docsTable, "docs");
    return registry;
}

/**
 * Every value a composed condition would bind, at any depth. Drizzle leaves a
 * templated value in `queryChunks` as-is until the query is built, so a
 * threshold appears as a bare number while a filter value arrives wrapped —
 * both are leaves here.
 */
function boundValues(node: unknown, out: unknown[] = []): unknown[] {
    if (node === null || node === undefined) return out;
    if (typeof node !== "object") {
        out.push(node);
        return out;
    }
    const anyNode = node as { value?: unknown; queryChunks?: unknown[] };
    if (Array.isArray(anyNode.queryChunks)) {
        for (const chunk of anyNode.queryChunks) boundValues(chunk, out);
        return out;
    }
    if ("value" in anyNode) out.push(anyNode.value);
    return out;
}

const VECTOR = [0.1, 0.2, 0.3];

describe("count() and a vector search", () => {
    it("applies the threshold, so `total` counts only the rows within it", async () => {
        const { db, seen } = recordingDb();

        await new FetchService(db as never, registryFor()).count("docs", {
            vectorSearch: { property: "embedding", vector: VECTOR, threshold: 0.2 }
        });

        expect(seen.where).toBeDefined();
        expect(boundValues(seen.where)).toContain(0.2);
    });

    it("composes no WHERE without a threshold, because ordering does not change a count", async () => {
        // The contrast is the point. If this one narrowed too, the count would
        // be answering a question the listing never asked.
        const { db, seen } = recordingDb();

        await new FetchService(db as never, registryFor()).count("docs", {
            vectorSearch: { property: "embedding", vector: VECTOR }
        });

        expect(seen.where).toBeUndefined();
    });

    it("adds the threshold on top of a filter rather than in place of it", async () => {
        const filter = { title: ["==", "Hello"] } as never;

        const withThreshold = recordingDb();
        await new FetchService(withThreshold.db as never, registryFor()).count("docs", {
            filter,
            vectorSearch: { property: "embedding", vector: VECTOR, threshold: 0.2 }
        });

        const filterOnly = recordingDb();
        await new FetchService(filterOnly.db as never, registryFor()).count("docs", { filter });

        expect(boundValues(withThreshold.seen.where)).toContain("Hello");
        expect(boundValues(withThreshold.seen.where)).toContain(0.2);
        expect(boundValues(filterOnly.seen.where)).not.toContain(0.2);
    });

    it("refuses a property that is not a vector column, as the listing does", async () => {
        // `/count` and the listing have to agree about what the request even
        // means: answering one with a 400 and the other with a number is how a
        // caller concludes the endpoint works and the collection is empty.
        const { db } = recordingDb();

        await expect(new FetchService(db as never, registryFor()).count("docs", {
            vectorSearch: { property: "title", vector: VECTOR, threshold: 0.2 }
        })).rejects.toThrow(ApiError);
    });
});
