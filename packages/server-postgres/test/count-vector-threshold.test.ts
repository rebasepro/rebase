import { describe, expect, it } from "@jest/globals";
import { pgTable, serial, varchar, vector } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { CollectionConfig, FilterValues } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";

import { FetchService } from "../src/services/FetchService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";

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
 * The db is drizzle's proxy driver: it answers a count of zero and keeps the
 * statement it was sent, so "was the threshold applied" is a question about
 * the SQL rather than about a database.
 */

const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    embedding: vector("embedding", { dimensions: 3 })
});

const docsCollection: CollectionConfig = {
    slug: "docs",
    name: "Docs",
    table: "docs",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        embedding: { type: "vector", dimensions: 3 }
    }
};

/**
 * A db that records the statement a count composed, and answers a count of 0.
 * `where` is the statement's WHERE clause, undefined when it has none;
 * `params` are the values it bound.
 */
function recordingDb() {
    const seen: { where: string | undefined; params: unknown[] } = { where: undefined, params: [] };
    const db = drizzle(async (sql, params) => {
        seen.where = sql.match(/ where (.*)$/i)?.[1];
        seen.params = params;
        return { rows: [[0]] };
    });
    return { db, seen };
}

function registryFor() {
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([docsCollection]);
    registry.registerPgTable(docsTable, "docs");
    return registry;
}

const VECTOR = [0.1, 0.2, 0.3];

describe("count() and a vector search", () => {
    it("applies the threshold, so `total` counts only the rows within it", async () => {
        const { db, seen } = recordingDb();

        await new FetchService(db, registryFor()).count("docs", {
            vectorSearch: { property: "embedding", vector: VECTOR, threshold: 0.2 }
        });

        expect(seen.where).toBeDefined();
        expect(seen.params).toContain(0.2);
    });

    it("composes no WHERE without a threshold, because ordering does not change a count", async () => {
        // The contrast is the point. If this one narrowed too, the count would
        // be answering a question the listing never asked.
        const { db, seen } = recordingDb();

        await new FetchService(db, registryFor()).count("docs", {
            vectorSearch: { property: "embedding", vector: VECTOR }
        });

        expect(seen.where).toBeUndefined();
    });

    it("adds the threshold on top of a filter rather than in place of it", async () => {
        const filter: FilterValues<string> = { title: ["==", "Hello"] };

        const withThreshold = recordingDb();
        await new FetchService(withThreshold.db, registryFor()).count("docs", {
            filter,
            vectorSearch: { property: "embedding", vector: VECTOR, threshold: 0.2 }
        });

        const filterOnly = recordingDb();
        await new FetchService(filterOnly.db, registryFor()).count("docs", { filter });

        expect(withThreshold.seen.params).toContain("Hello");
        expect(withThreshold.seen.params).toContain(0.2);
        expect(filterOnly.seen.params).not.toContain(0.2);
    });

    it("refuses a property that is not a vector column, as the listing does", async () => {
        // `/count` and the listing have to agree about what the request even
        // means: answering one with a 400 and the other with a number is how a
        // caller concludes the endpoint works and the collection is empty.
        const { db } = recordingDb();

        await expect(new FetchService(db, registryFor()).count("docs", {
            vectorSearch: { property: "title", vector: VECTOR, threshold: 0.2 }
        })).rejects.toThrow(ApiError);
    });
});
