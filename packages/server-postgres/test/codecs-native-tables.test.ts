/**
 * The codecs, through the doors a caller uses, on a table authored with
 * `defineTable` — not a lifted legacy collection.
 *
 * Each decision about how a value reaches Postgres and comes back is taken
 * from the column's Postgres type (`ColumnDescriptor.type`, `semantic`,
 * `json`): a field operation's bounds from `.validate()`, a `time` column's
 * time of day, a geopoint's shape, a date and a number inside a jsonb
 * document. REST is the request door (`RestApiGenerator` over the real
 * driver); the admin's view model is what the driver's `fetchOne` serves.
 *
 * Against a real Postgres (PGlite), with the table created from the plan of
 * the same definition.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import { col, defineTable, json } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { RestApiGenerator } from "../../server/src/api/rest/api-generator";
import { errorHandler } from "../../server/src/api/errors";
import type { HonoEnv } from "../../server/src/api/types";
import { testUser } from "./helpers/spg-b-fixtures";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const shelves = defineTable("shelves", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        stock: col.integer().validate({ min: 0, max: 10 }),
        tags: col.text().array().validate({ minItems: 1, maxItems: 3, uniqueItems: true }),
        meta: col.jsonb(json.object({ color: json.string(), size: json.number() })),
        opensAt: col.time(),
        place: col.geopoint(),
        log: col.jsonb(json.object({ seenAt: json.date(), scores: json.array(json.number()) }))
    },
    rls: "admin-only"
});

const ADMIN = testUser({ uid: "codec-admin", roles: ["admin"] });

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => ({ rows: (await db.query<T>(statement, values)).rows })
});

let db: PGlite;
let app: Hono<HonoEnv>;
let driver: PostgresBackendDriver;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const compiled = compileSchema([shelves]);
    await db.exec(renderPostgresDdl(planSchema(compiled, { databaseExtensions: [] }), {
        includePolicies: false, includeSearch: false, includeVector: false
    }));
    const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
    const registry = new PostgresTableRegistry();
    registry.registerTables(compiled);
    for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
    const orm = pgliteNodePg(db, { schema: catalogue.tables });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);

    app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/api/data/*", async (c, next) => {
        c.set("user", ADMIN);
        // The driver as the server holds it for an administrator. PGlite is one
        // connection, so the per-request role switch is not exercised here.
        c.set("driver", driver);
        await next();
    });
    app.route("/api/data", new RestApiGenerator({ descriptors: compiled.map(table => table.descriptor) }, driver).generateRoutes());
});

afterAll(async () => {
    await db.close();
});

interface Answer {
    status: number;
    body: Record<string, unknown>;
}

async function send(method: string, path: string, body?: unknown): Promise<Answer> {
    const response = await app.request(`/api/data/shelves${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const parsed: unknown = await response.json();
    const record: Record<string, unknown> = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
    return { status: response.status, body: record };
}

function errorCode(answer: Answer): unknown {
    const error = answer.body.error;
    return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

async function stored(id: unknown): Promise<Record<string, unknown>> {
    const result = await db.query<Record<string, unknown>>(
        "SELECT stock, tags, meta, opens_at::text AS opens_at, place, log FROM shelves WHERE id = $1", [id]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`no shelf ${String(id)}`);
    return row;
}

async function createShelf(): Promise<unknown> {
    const created = await send("POST", "", {
        stock: 5,
        tags: ["a"],
        meta: { color: "red" },
        opensAt: "1970-01-01T09:30:00.000Z",
        place: { latitude: 41.38, longitude: 2.17 },
        log: { seenAt: "2024-01-01T00:00:00Z", scores: [1, "NaN"] }
    });
    expect({ status: created.status, error: created.body.error }).toEqual({ status: 201, error: undefined });
    return created.body.id;
}

describe("writes: each column's value by its Postgres type", () => {
    it("stores a time column as the UTC time of day, a geopoint as its point, and walks the jsonb shape", async () => {
        const id = await createShelf();
        expect(await stored(id)).toEqual({
            stock: 5,
            tags: ["a"],
            meta: { color: "red" },
            opens_at: "09:30:00",
            place: { latitude: 41.38, longitude: 2.17 },
            // A date inside the document normalised to ISO; a number that did not parse is no value.
            log: { seenAt: "2024-01-01T00:00:00.000Z", scores: [1, null] }
        });
    });

    it("refuses a geopoint that is not { latitude, longitude }, and a list that is not one", async () => {
        const id = await createShelf();
        expect((await send("PATCH", `/${String(id)}`, { place: "41.38,2.17" })).status).toBe(400);
        expect((await send("PATCH", `/${String(id)}`, { log: { scores: 3 } })).status).toBe(400);
        expect((await stored(id)).place).toEqual({ latitude: 41.38, longitude: 2.17 });
    });
});

describe("field operators answer to the column's .validate()", () => {
    it("$inc stays within min and max, decided in the UPDATE", async () => {
        const id = await createShelf();
        const over = await send("PATCH", `/${String(id)}`, { stock: { $inc: 6 } });
        expect([over.status, errorCode(over)]).toEqual([400, "VALIDATION_CONSTRAINT"]);
        const under = await send("PATCH", `/${String(id)}`, { stock: { $inc: -6 } });
        expect([under.status, errorCode(under)]).toEqual([400, "VALIDATION_CONSTRAINT"]);
        expect((await stored(id)).stock).toBe(5);

        expect((await send("PATCH", `/${String(id)}`, { stock: { $inc: 5 } })).status).toBe(200);
        expect((await stored(id)).stock).toBe(10);
    });

    it("$push and $pull keep a list within minItems and maxItems", async () => {
        const id = await createShelf();
        const tooMany = await send("PATCH", `/${String(id)}`, { tags: { $push: ["b", "c", "d"] } });
        expect([tooMany.status, errorCode(tooMany)]).toEqual([400, "VALIDATION_CONSTRAINT"]);
        const tooFew = await send("PATCH", `/${String(id)}`, { tags: { $pull: "a" } });
        expect([tooFew.status, errorCode(tooFew)]).toEqual([400, "VALIDATION_CONSTRAINT"]);
        expect((await stored(id)).tags).toEqual(["a"]);

        expect((await send("PATCH", `/${String(id)}`, { tags: { $push: ["b", "c"] } })).status).toBe(200);
        expect((await stored(id)).tags).toEqual(["a", "b", "c"]);
    });

    it("$push refuses items that repeat on a uniqueItems list", async () => {
        const id = await createShelf();
        const repeated = await send("PATCH", `/${String(id)}`, { tags: { $push: ["b", "b"] } });
        expect(repeated.status).toBe(400);
        expect(JSON.stringify(repeated.body)).toContain("unique_items");
        expect((await stored(id)).tags).toEqual(["a"]);
    });

    it("$merge merges into a json.object document", async () => {
        const id = await createShelf();
        expect((await send("PATCH", `/${String(id)}`, { meta: { $merge: { size: 3 } } })).status).toBe(200);
        expect((await stored(id)).meta).toEqual({ color: "red", size: 3 });
    });
});

describe("reads", () => {
    it("REST serves the time of day and the document as stored", async () => {
        const id = await createShelf();
        const read = await send("GET", `/${String(id)}`);
        expect(read.status).toBe(200);
        expect(read.body).toMatchObject({
            stock: 5,
            opensAt: "09:30:00",
            place: { latitude: 41.38, longitude: 2.17 },
            log: { seenAt: "2024-01-01T00:00:00.000Z", scores: [1, null] }
        });
    });

    it("the driver's own read serves the REST row: no envelope, a time as its text", async () => {
        const id = await createShelf();
        const entity = await driver.fetchOne({ path: "shelves", id: String(id) });
        const rest = await driver.restFetchService.fetchOneForRest("shelves", String(id));
        expect(entity).toEqual(rest);
        expect(entity).toMatchObject({
            opensAt: "09:30:00",
            place: { latitude: 41.38, longitude: 2.17 },
            log: { seenAt: "2024-01-01T00:00:00.000Z", scores: [1, null] }
        });
    });
});
