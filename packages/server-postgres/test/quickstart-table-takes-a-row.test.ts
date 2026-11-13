/**
 * The quickstart's first table takes a row.
 *
 * `getting-started/quickstart.md` has a new user write `backend/schema/products.ts`
 * and then create a product. Before 0.31 the page's collection declared no key,
 * got an implicit `id TEXT PRIMARY KEY` with **no default**, and the first
 * product a new user tried to create was refused with
 * `Missing required field: "id" in "products" cannot be empty.` — over REST, in
 * the panel and through the SDK alike.
 *
 * So the table under test is not a copy: it is **read from the page**, the
 * fence titled `backend/schema/products.ts`, compiled and evaluated with the
 * real `defineTable`, and lowered the way boot lowers it. Edit the page and
 * this test runs the edit.
 *
 * Three ways the table comes to exist, each with its own row written:
 *  - boot's additive ensure on an empty database (`rebase dev`, a managed deploy);
 *  - boot's ensure on a table an older Rebase created with the no-default
 *    implicit key, which must gain the default rather than stay unwritable
 *    (that table's key is the implicit one, so it is declared here, not read
 *    from the page, whose key is its own);
 *  - `schema.sql`, the desired state `db push` hands Atlas.
 * The driver reads the table through the `schema.generated.ts` the generator
 * renders for the same table, as a project does.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import ts from "typescript";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";
import * as schemaBuilders from "@rebasepro/types";
import { compileSchema, lowerTables } from "@rebasepro/common";
import { createRebaseClient } from "@rebasepro/client";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderDrizzleSchema } from "../src/schema/plan/render-drizzle";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { ensureTables } from "../src/schema/ensure-tables";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import { RestApiGenerator } from "../../server/src/api/rest/api-generator";
import { errorHandler } from "../../server/src/api/errors";
import type { HonoEnv } from "../../server/src/api/types";
import { testUser } from "./helpers/spg-b-fixtures";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const QUICKSTART = path.resolve(
    PACKAGE_ROOT, "..", "..", "website", "src", "content", "docs", "docs", "getting-started", "quickstart.md"
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the scaffold's `backend/schema/index.ts` exports as `defaultRls`, which the page's `"inherit"` takes. */
const SCAFFOLD_DEFAULT_RLS: schemaBuilders.DefaultRls = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];

/** The compiled table each lowered collection came from: what the planner takes. */
const compiledOf = new WeakMap<CollectionConfig, schemaBuilders.CompiledTable>();

/** One table definition, lowered into the collection the runtime reads — as boot does. */
function lowered(def: schemaBuilders.AnyTableDef): CollectionConfig {
    const [collection] = lowerTables([def], { defaultRls: SCAFFOLD_DEFAULT_RLS });
    compiledOf.set(collection, compileSchema([def], { defaultRls: SCAFFOLD_DEFAULT_RLS })[0]);
    return collection;
}

/** The compiled tables of lowered collections, for the planner's doors. */
function compiled(collections: CollectionConfig[]): schemaBuilders.CompiledTable[] {
    return collections.map(collection => {
        const table = compiledOf.get(collection);
        if (!table) throw new Error(`"${collection.slug}" was not lowered here`);
        return table;
    });
}

/**
 * The page's `backend/schema/products.ts`, as a project would load it.
 *
 * The one import a table file makes is resolved to the real builders, and
 * anything else the snippet reaches for is a failure: a page that starts
 * importing something new should say so here rather than be stubbed past.
 */
function quickstartTableDef(): schemaBuilders.AnyTableDef {
    const page = fs.readFileSync(QUICKSTART, "utf8");
    const fence = /```typescript title="backend\/schema\/products\.ts"\n([\s\S]*?)\n```/.exec(page);
    if (!fence) {
        throw new Error(`${QUICKSTART} has no \`backend/schema/products.ts\` fence — the guard lost its input`);
    }
    const { outputText } = ts.transpileModule(fence[1], {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const load = (specifier: string): unknown => {
        if (specifier === "@rebasepro/server/schema") return schemaBuilders;
        throw new Error(`the quickstart's table imports "${specifier}", which this guard does not provide`);
    };
    const module = { exports: {} as Record<string, unknown> };
    const evaluate = vm.runInThisContext(`(function (require, module, exports) {\n${outputText}\n})`) as
        (require: (specifier: string) => unknown, module: { exports: object }, exports: object) => void;
    evaluate(load, module, module.exports);
    const def = Object.values(module.exports).find(schemaBuilders.isTableDef);
    if (!def) throw new Error("the quickstart's table file exports no defineTable");
    return def;
}

function quickstartCollection(): CollectionConfig {
    return lowered(quickstartTableDef());
}

interface GeneratedModule {
    tables: Record<string, unknown>;
}

/** `schema.generated.ts` for the collection, compiled and loaded inside this package. */
function loadGenerated(collection: CollectionConfig): GeneratedModule {
    const source = renderDrizzleSchema(planSchema(compiled([collection])), { policies: false });
    const dir = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".schema-run-"));
    try {
        const file = path.join(dir, "schema.generated.cjs");
        const { outputText } = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
        });
        fs.writeFileSync(file, outputText);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(file) as GeneratedModule;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(sql: string) => ({ rows: (await db.query<T>(sql)).rows })
});

const ADMIN = testUser({ uid: "quickstart-admin", roles: ["admin"] });

/** REST as `init.ts` mounts it, and the SDK pointed at it, over one driver. */
function doors(db: PGlite, collection: CollectionConfig) {
    const generated = loadGenerated(collection);
    const tables: Record<string, PgTable> = {};
    for (const [name, exported] of Object.entries(generated.tables)) {
        if (is(exported, PgTable)) tables[name] = exported;
    }
    const table = tables[collection.slug];
    if (!table) throw new Error(`schema.generated.ts exports no table for "${collection.slug}"`);

    const registry = new FixtureTableRegistry();
    registry.registerMultiple([collection]);
    registry.registerPgTable(table, collection.slug);
    const orm = pgliteNodePg(db, { schema: tables });
    const driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/api/data/*", async (c, next) => {
        c.set("user", ADMIN);
        c.set("driver", await driver.withAuth(ADMIN));
        await next();
    });
    app.route("/api/data", new RestApiGenerator({ descriptors: compiled([collection]).map(table => table.descriptor) }, driver).generateRoutes());

    const client = createRebaseClient({
        baseUrl: "http://quickstart.test",
        token: "quickstart-test-token",
        fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
            app.request(input instanceof Request ? input : String(input), init)) as typeof fetch
    });

    return { app, client };
}

/** A product, created over REST and through the SDK, with no key on either. */
async function createProducts(db: PGlite, collection: CollectionConfig): Promise<void> {
    const { app, client } = doors(db, collection);

    const response = await app.request(`/api/data/${collection.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Widget", price: 10 })
    });
    const body = await response.json() as { id?: unknown; error?: { message?: string } };
    expect({ status: response.status, error: body.error?.message }).toEqual({ status: 201, error: undefined });
    expect(String(body.id)).toMatch(UUID);

    const viaSdk = await client.data.table(collection.slug).create({ name: "Gadget", price: 5 });
    expect(String(viaSdk.id)).toMatch(UUID);
    expect(viaSdk.id).not.toBe(body.id);

    const stored = await db.query<{ id: string; name: string; active: boolean }>(
        `SELECT id, name, active FROM "public"."${collection.slug}" ORDER BY name`
    );
    expect(stored.rows.map(row => row.name)).toEqual(["Gadget", "Widget"]);
    // The page's `defaultValue: true` landed too — the row is the one the page describes.
    expect(stored.rows.every(row => row.active === true)).toBe(true);
}

describe("the quickstart's `products` table, read from the page", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterEach(async () => {
        await db.close();
    });

    it("is the table the page shows, keyed by a column the database fills", () => {
        // The precondition the rest rests on: a key no write door has to send.
        const def = quickstartTableDef();
        expect(def.name).toBe("products");
        const id = def.config.columns.id;
        expect(id?.def.primaryKey).toBe(true);
        expect(id?.def.default).toBeDefined();
    });

    it("takes a row over REST and through the SDK after boot creates the table", async () => {
        const collection = quickstartCollection();
        await ensureTables(queryable(db), compiled([collection]));
        await createProducts(db, collection);
    });

    it("takes a row once boot has given an older table's key its default", async () => {
        // The table an earlier Rebase created for the same file: `id TEXT
        // PRIMARY KEY` and nothing to fill it. Boot never alters a column, but
        // a DEFAULT binds only future writes, so it is the one change it makes.
        const { defineTable, col, sql } = schemaBuilders;
        const collection = lowered(defineTable("products", {
            columns: {
                // The planner's implicit key: what a key-less collection got.
                id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
                name: col.text().notNull(),
                price: col.numeric().notNull(),
                description: col.text(),
                active: col.boolean().default(true),
                createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
            },
            rls: "inherit"
        }));
        await db.exec(`
            CREATE TABLE "public"."products" (
                "id" TEXT PRIMARY KEY,
                "name" TEXT NOT NULL,
                "price" NUMERIC NOT NULL,
                "description" TEXT,
                "active" BOOLEAN DEFAULT TRUE,
                "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
            );
        `);
        const outcome = await ensureTables(queryable(db), compiled([collection]));
        expect(outcome.failures).toEqual([]);
        await createProducts(db, collection);
    });

    it("takes a row in a database built from `schema.sql`, the state `db push` converges to", async () => {
        const collection = quickstartCollection();
        await db.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
        await db.exec(renderPostgresDdl(planSchema(compiled([collection])), { includePolicies: false }));
        await createProducts(db, collection);
    });
});
