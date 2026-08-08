/**
 * Vector search must fail where it cannot work, and say why.
 *
 * Three paths answered the wrong thing quietly:
 *
 *  1. `?vector_search=<name>` was an unvalidated key into the drizzle table
 *     object. `?vector_search=title` compiled `"title" <=> '[…]'::vector`, which
 *     the database rejects — and the driver error is not an `ApiError`, so a
 *     malformed request came back as a 500 "An unexpected error occurred" with a
 *     stack logged as an incident. A table object's non-column keys (`_`, its
 *     methods) passed the `if (!column)` guard on the way to the same place.
 *  2. Nothing in the OSS pipeline installs pgvector, so the first boot of a
 *     collection declaring `{ type: "vector" }` died on `type "vector" does not
 *     exist` — accurate, and useless to whoever read it on a crash-looping pod.
 *  3. `.vectorSearch(...).listen()` degraded to an ordinary `id DESC` listing:
 *     the parameter was read once, for the limit default, and then dropped.
 *
 * Installing an extension, adding an ANN index or changing the scaffold's image
 * are deployment decisions, so none of them is taken here. Being loud about the
 * gap is not a decision — it is the difference between a refusal and a lie.
 */
import { CollectionConfig } from "@rebasepro/types";
import { pgTable, serial, text, vector } from "drizzle-orm/pg-core";
import { ApiError } from "@rebasepro/server";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";
import { ensureCollectionTables } from "../src/schema/ensure-collection-tables";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

// The control case ("a subscription without one still works") has to reach a
// fetch; the fetch itself is not what this file is about.
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(null),
        searchRows: jest.fn().mockResolvedValue([])
    }))
}));

const docs = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: text("title"),
    embedding: vector("embedding", { dimensions: 3 })
});

describe("the vector property named by a request", () => {
    const build = (property: string) =>
        DrizzleConditionBuilder.buildVectorSearchConditions(docs, { property, vector: [1, 2, 3] });

    it("compiles when it really is a vector column", () => {
        expect(build("embedding").distanceSelect).toBeDefined();
    });

    it("is a 400 when the collection has no such property", () => {
        expect(() => build("nope")).toThrow(ApiError);
        try {
            build("nope");
        } catch (e) {
            expect((e as ApiError).statusCode).toBe(400);
            expect((e as ApiError).code).toBe("UNKNOWN_VECTOR_PROPERTY");
            // Names the alternatives, since the caller cannot see the schema.
            expect((e as ApiError).message).toContain("embedding");
        }
    });

    it("is a 400 when the property exists but is not a vector", () => {
        expect(() => build("title")).toThrow(/not a vector column/);
        expect(() => build("title")).toThrow(ApiError);
    });

    it("is a 400 for a key of the table object that is not a column at all", () => {
        // `_` and the table's methods are properties of the drizzle object, and
        // a bare key lookup accepted every one of them.
        expect(() => build("_")).toThrow(ApiError);
        expect(() => build("getSQL")).toThrow(ApiError);
    });
});

describe("a database without pgvector", () => {
    const withVector: CollectionConfig = {
        slug: "docs",
        table: "docs",
        name: "Docs",
        properties: {
            id: { type: "string", isId: "uuid" },
            embedding: { type: "vector", dimensions: 1536 }
        }
    };

    it("fails the boot with something the reader can act on", async () => {
        const client = {
            query: jest.fn(async (sql: string) => {
                if (/ADD COLUMN .*"embedding"/.test(sql)) {
                    throw new Error(`type "vector" does not exist`);
                }
                return { rows: [] };
            })
        };

        await expect(ensureCollectionTables(client as never, [withVector]))
            .rejects.toThrow(/pgvector is not installed/);
        // The three things missing from `type "vector" does not exist`: what to
        // install, that Rebase will not do it, and that the scaffold's image
        // does not carry it.
        await expect(ensureCollectionTables(client as never, [withVector]))
            .rejects.toThrow(/CREATE EXTENSION vector/);
        await expect(ensureCollectionTables(client as never, [withVector]))
            .rejects.toThrow(/postgres:18-alpine/);
    });

    it("leaves every other DDL failure worded as it was", async () => {
        const client = {
            query: jest.fn(async (sql: string) => {
                if (/ADD COLUMN/.test(sql)) throw new Error("permission denied for table docs");
                return { rows: [] };
            })
        };

        await expect(ensureCollectionTables(client as never, [withVector]))
            .rejects.toThrow(/permission denied/);
        await expect(ensureCollectionTables(client as never, [withVector]))
            .rejects.not.toThrow(/pgvector/);
    });
});

describe("a realtime subscription that asks for a vector search", () => {
    const collection: CollectionConfig = {
        slug: "docs",
        name: "Docs",
        table: "docs",
        properties: { id: { type: "number", isId: true } },
        idField: "id"
    };

    const setup = () => {
        const db = {
            execute: jest.fn().mockResolvedValue({ rows: [] }),
            transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
        } as unknown as NodePgDatabase<Record<string, never>>;
        const registry = new PostgresCollectionRegistry();
        jest.spyOn(registry, "getCollectionByPath").mockReturnValue(collection);

        const service = new RealtimeService(
            db, registry, { defaultDatabaseName: "main" } as never, "test-instance",
            { accessTokenSecret: "secret" } as never
        );
        const ws = { readyState: 1, send: jest.fn(), on: jest.fn() };
        service.addClient("client-1", ws as never);
        return { service, ws };
    };

    it("is refused, not quietly answered with an ordinary listing", async () => {
        const { service, ws } = setup();

        await service.handleClientMessage("client-1", {
            type: "subscribe_collection",
            payload: {
                path: "docs",
                subscriptionId: "sub-1",
                vectorSearch: { property: "embedding", vector: [0.1, 0.2, 0.3] }
            }
        });

        const sent = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
        const error = sent.find(m => m.type === "error");
        expect(error).toBeDefined();
        expect(error.subscriptionId).toBe("sub-1");
        expect(error.payload.error.code).toBe("VECTOR_SEARCH_NOT_LIVE");
        // And no rows: the whole failure was that ten wrong ones came back.
        expect(sent.some(m => m.type === "collection_update")).toBe(false);
        expect(service.subscriptions.has("sub-1")).toBe(false);
    });

    it("leaves a subscription without one alone", async () => {
        const { service, ws } = setup();

        await service.handleClientMessage("client-1", {
            type: "subscribe_collection",
            payload: { path: "docs", subscriptionId: "sub-2" }
        });

        const sent = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
        expect(sent.some(m => m.type === "error")).toBe(false);
        expect(service.subscriptions.has("sub-2")).toBe(true);
    });
});
