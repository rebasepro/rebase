/**
 * A vector search pages by offset, and says so when handed a cursor.
 *
 * A vector read orders by distance, which is computed per query and stored
 * nowhere. Its page still got a `nextCursor`, built from the row's id alone,
 * and the next request seeked with `id < lastId` under `ORDER BY distance` —
 * page two was the rows with a smaller id, in distance order, which is neither
 * the next page nor any page.
 *
 * So a vector row is issued no cursor, and a cursor sent with a vector search
 * is a 400, as one sent with a relevance sort already was.
 */
import { describe, it, expect } from "@jest/globals";
import { pgTable, serial, text, vector } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";

import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: text("title"),
    embedding: vector("embedding", { dimensions: 3 })
});

const docs: CollectionConfig = {
    name: "Docs",
    slug: "docs",
    table: "docs",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        embedding: { name: "Embedding", type: "vector", dimensions: 3 }
    }
};

function service(): FetchService {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([docs]);
    registry.registerTable(docsTable, "docs");
    // No database: the refusal has to come before anything is asked of one.
    return new FetchService({} as never, registry);
}

describe("a vector read", () => {
    it("issues no cursor for its rows", () => {
        const fetch = service();
        expect(fetch.cursorFor("docs", { id: 7, title: "a", _distance: 0.12 })).toBeUndefined();
        // The control: the same row from an ordinary listing gets one.
        expect(fetch.cursorFor("docs", { id: 7, title: "a" })).toBeDefined();
    });

    it("refuses a cursor, rather than seeking by id under a distance order", async () => {
        const error = await service().fetchCollectionForRest("docs", {
            vectorSearch: { property: "embedding", vector: [1, 0, 0] },
            startAfter: { id: 7, values: {} },
            limit: 10
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).statusCode).toBe(400);
        expect((error as ApiError).code).toBe("VECTOR_CURSOR_UNSUPPORTED");
    });
});
