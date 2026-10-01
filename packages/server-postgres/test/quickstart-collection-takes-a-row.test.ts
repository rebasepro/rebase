/**
 * The quickstart's first collection takes a row.
 *
 * `getting-started/quickstart.md` has a new user write `config/collections/products.ts`
 * and then create a product. The collection declares no key, as most examples
 * in the docs do, so it got an implicit `id TEXT PRIMARY KEY` with **no
 * default**, and nothing on any write door fills a key that is not a property:
 * the CMS form has no field for it, REST and the SDK send none. The first
 * product a new user tried to create was refused with
 * `Missing required field: "id" in "products" cannot be empty.` — over REST, in
 * the panel and through the SDK alike.
 *
 * So the collection under test is not a copy: it is **read from the page**, the
 * fence titled `config/collections/products.ts`, compiled and evaluated with the
 * real `defineCollection`. Edit the page and this test runs the edit.
 *
 * Three ways the table comes to exist, each with its own row written:
 *  - boot's additive ensure on an empty database (`rebase dev`, a managed deploy);
 *  - boot's ensure on a table an older Rebase created with the no-default key,
 *    which must gain the default rather than stay unwritable;
 *  - `schema.sql`, the desired state `db push` hands Atlas.
 * The driver reads the table through the `schema.generated.ts` the generator
 * renders for the same collection, as a project does.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import ts from "typescript";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";
import { createRebaseClient } from "@rebasepro/client";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderDrizzleSchema } from "../src/schema/plan/render-drizzle";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { ensureCollectionTables } from "../src/schema/ensure-collection-tables";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { RestApiGenerator } from "../../server/src/api/rest/api-generator";
import { errorHandler } from "../../server/src/api/errors";
import type { HonoEnv } from "../../server/src/api/types";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const QUICKSTART = path.resolve(
    PACKAGE_ROOT, "..", "..", "website", "src", "content", "docs", "docs", "getting-started", "quickstart.md"
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The page's `config/collections/products.ts`, as a project would load it.
 *
 * The one import a collection file makes is resolved to the real builder, and
 * anything else the snippet reaches for is a failure: a page that starts
 * importing something new should say so here rather than be stubbed past.
 */
function quickstartCollection(): CollectionConfig {
    const page = fs.readFileSync(QUICKSTART, "utf8");
    const fence = /```typescript title="config\/collections\/products\.ts"\n([\s\S]*?)\n```/.exec(page);
    if (!fence) {
        throw new Error(`${QUICKSTART} has no \`config/collections/products.ts\` fence — the guard lost its input`);
    }
    const { outputText } = ts.transpileModule(fence[1], {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const load = (specifier: string): unknown => {
        if (specifier === "@rebasepro/cms-types") {
            // The builder's own module: `@rebasepro/cms-types`' index also
            // exports the panel's view models, which import React as a value.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return require("../../cms-types/src/define_collection");
        }
        throw new Error(`the quickstart's collection imports "${specifier}", which this guard does not provide`);
    };
    const module = { exports: {} as { default?: unknown } };
    const evaluate = vm.runInThisContext(`(function (require, module, exports) {\n${outputText}\n})`) as
        (require: (specifier: string) => unknown, module: { exports: object }, exports: object) => void;
    evaluate(load, module, module.exports);
    const collection = module.exports.default as CollectionConfig | undefined;
    if (!collection?.slug) throw new Error("the quickstart's collection file default-exports no collection");
    return collection;
}

interface GeneratedModule {
    tables: Record<string, unknown>;
}

/** `schema.generated.ts` for the collection, compiled and loaded inside this package. */
function loadGenerated(collection: CollectionConfig): GeneratedModule {
    const source = renderDrizzleSchema(planSchema([collection]), { policies: false });
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

const ADMIN = { uid: "quickstart-admin", roles: ["admin"] };

/** REST as `init.ts` mounts it, and the SDK pointed at it, over one driver. */
function doors(db: PGlite, collection: CollectionConfig) {
    const generated = loadGenerated(collection);
    const table = generated.tables[collection.slug];
    if (!table) throw new Error(`schema.generated.ts exports no table for "${collection.slug}"`);

    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([collection]);
    registry.registerTable(table as never, collection.slug);
    const orm = drizzle(db, { schema: generated.tables as never }) as never;
    const driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/api/data/*", async (c, next) => {
        c.set("user", ADMIN as never);
        c.set("driver", await driver.withAuth(ADMIN as never));
        await next();
    });
    app.route("/api/data", new RestApiGenerator([collection], driver).generateRoutes());

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

    const viaSdk = await client.data.collection(collection.slug).create({ name: "Gadget", price: 5 });
    expect(String(viaSdk.id)).toMatch(UUID);
    expect(viaSdk.id).not.toBe(body.id);

    const stored = await db.query<{ id: string; name: string; active: boolean }>(
        `SELECT id, name, active FROM "public"."${collection.slug}" ORDER BY name`
    );
    expect(stored.rows.map(row => row.name)).toEqual(["Gadget", "Widget"]);
    // The page's `defaultValue: true` landed too — the row is the one the page describes.
    expect(stored.rows.every(row => row.active === true)).toBe(true);
}

describe("the quickstart's `products` collection, read from the page", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterEach(async () => {
        await db.close();
    });

    it("is the collection the page shows, with no key of its own", () => {
        // The precondition the rest rests on. If the page starts declaring an
        // `isId`, this file stops guarding the implicit key and should say so.
        const collection = quickstartCollection();
        expect(collection.slug).toBe("products");
        expect(Object.values(collection.properties ?? {}).some(prop => "isId" in prop && prop.isId)).toBe(false);
        expect(collection.properties).not.toHaveProperty("id");
    });

    it("takes a row over REST and through the SDK after boot creates the table", async () => {
        const collection = quickstartCollection();
        await ensureCollectionTables(queryable(db), [collection]);
        await createProducts(db, collection);
    });

    it("takes a row once boot has given an older table's key its default", async () => {
        // The table an earlier Rebase created for the same file: `id TEXT
        // PRIMARY KEY` and nothing to fill it. Boot never alters a column, but
        // a DEFAULT binds only future writes, so it is the one change it makes.
        const collection = quickstartCollection();
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
        const outcome = await ensureCollectionTables(queryable(db), [collection]);
        expect(outcome.failures).toEqual([]);
        await createProducts(db, collection);
    });

    it("takes a row in a database built from `schema.sql`, the state `db push` converges to", async () => {
        const collection = quickstartCollection();
        await db.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
        await db.exec(renderPostgresDdl(planSchema([collection]), { includePolicies: false }));
        await createProducts(db, collection);
    });
});
