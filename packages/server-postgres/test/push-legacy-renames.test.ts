/**
 * `db push` on a database aged by pre-0.13 Rebase: the junction still holds
 * `categorie_id`, the current rule derives `category_id`. Boot renames it;
 * push ran Atlas, which planned DROP `categorie_id` + ADD `category_id` and
 * offered to destroy every link. Push now finds the same renames boot runs,
 * and runs them before Atlas plans.
 */
import { PGlite } from "@electric-sql/pglite";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { generateForeignKeyName, legacyForeignKeyName } from "@rebasepro/utils";
import { ensureTables, type Queryable } from "../src/schema/ensure-tables";
import { legacyForeignKeyRenames } from "../src/schema/push-legacy-renames";
import { compileSet } from "./helpers/plan-tables";

const categories: LegacyCollectionConfig = {
    slug: "categories",
    table: "categories",
    name: "Categories",
    properties: { id: { type: "string", isId: "uuid" }, name: { type: "string" } }
};

const products: LegacyCollectionConfig = {
    slug: "products",
    table: "products",
    name: "Products",
    properties: {
        id: { type: "string", isId: "uuid" },
        categories: { type: "relation", relation: { kind: "manyToMany", target: () => categories, relationName: "categories" } }
    }
};

const CURRENT = generateForeignKeyName("categories");
const LEGACY = legacyForeignKeyName("categories");

describe("db push on a database whose relation columns carry the pre-0.13 names", () => {
    it("finds the rename boot would run, and after it there is nothing left to rename", async () => {
        expect(LEGACY).not.toBe(CURRENT);
        const db = new PGlite();
        const client: Queryable = { query: async <T,>(text: string) => ({ rows: (await db.query<T>(text)).rows }) };
        await db.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
        await ensureTables(db, compileSet([products, categories]));
        const junction = (await db.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.columns WHERE column_name = '${CURRENT}' AND table_schema = 'public'`
        )).rows[0].table_name;
        await db.exec(`ALTER TABLE "public"."${junction}" RENAME COLUMN "${CURRENT}" TO "${LEGACY}";`);

        const renames = await legacyForeignKeyRenames(client, compileSet([products, categories]));
        expect(renames).toEqual([expect.objectContaining({
            table: `public.${junction}`,
            legacy: LEGACY,
            expected: CURRENT,
            sql: `ALTER TABLE "public"."${junction}" RENAME COLUMN "${LEGACY}" TO "${CURRENT}";`
        })]);

        for (const rename of renames) await db.exec(rename.sql);
        expect(await legacyForeignKeyRenames(client, compileSet([products, categories]))).toEqual([]);
        await db.close();
    });
});
