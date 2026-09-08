import { pgTable, text } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";

import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { assertRelationsResolve } from "../src/collections/validate-relations";

/**
 * What the boot error tells you when a relation names a column the database
 * lacks.
 *
 * This check used to read the project's generated Drizzle schema —
 * `backend/src/schema.generated.ts` — while calling it "the database schema".
 * The two are the same thing right up until they are not, and the case where
 * they diverge is the one that mattered: a 0.12 → 0.13 upgrade renames a
 * junction foreign key *in the database* (`categorie_id` → `category_id`, a
 * plural slug singularised), preserves the rows, and then boot died here on
 * every restart, because the checked-in file still declared the old name.
 *
 * The registry now holds tables read back from `information_schema`, so the
 * artifact that could be stale is gone and this check can only refuse over a
 * real disagreement between the collections and the database. What is left is
 * the *other* half of the same upgrade: a database nothing has migrated yet,
 * still carrying the pre-rename column, which is what this fixture is.
 *
 * The message must therefore not send anyone to the config. It said the column
 * "is not a column on the junction table" and offered `fix: set
 * through.targetColumn to one of: product_id, categorie_id` — advice that pins
 * a column boot-ensure is about to rename away.
 */

// The junction as it stands in a database that has not been migrated: the
// pre-rename spelling, read back from the catalogue.
const categories_products = pgTable("categories_products", {
    product_id: text("product_id"),
    categorie_id: text("categorie_id")
});
const products = pgTable("products", { id: text("id").primaryKey() });
const categories = pgTable("categories", { id: text("id").primaryKey() });

const categoriesCollection = {
    slug: "categories", name: "categories", table: "categories",
    properties: { id: { type: "string", isId: true } }
} as unknown as CollectionConfig;

// The config after the upgrade: correct, and newer than the database.
const productsCollection = {
    slug: "products", name: "products", table: "products",
    properties: { id: { type: "string", isId: true } },
    relations: [{
        kind: "manyToMany",
        relationName: "categories",
        target: () => categoriesCollection,
        through: { table: "categories_products", sourceColumn: "product_id", targetColumn: "category_id" }
    }]
} as unknown as CollectionConfig;

function boot() {
    const registry = new PostgresCollectionRegistry();
    const all = [productsCollection, categoriesCollection];
    registry.registerMultiple(all);
    for (const [name, table] of Object.entries({ products, categories, categories_products })) {
        registry.registerTable(table as never, name);
    }
    assertRelationsResolve(all, registry);
}

function bootMessage(): string {
    try {
        boot();
    } catch (e) {
        return (e as Error).message;
    }
    throw new Error("expected the boot check to refuse");
}

describe("relation validation against a database the schema was never applied to", () => {
    it("still refuses to boot on a relation it cannot resolve", () => {
        expect(boot).toThrow();
    });

    it("says it read the database, because now it did", () => {
        // The inverse of what this file used to pin. The tables in the registry
        // come from `information_schema`, so naming the generated file here
        // would be the lie it once was in the other direction.
        const message = bootMessage();
        expect(message).toMatch(/against the database/);
        expect(message).not.toMatch(/cannot resolve against\s*\n?`backend\/src\/schema\.generated\.ts`/);
    });

    it("offers applying the schema before the per-relation detail", () => {
        // The ordering is the fix. The config is right and the database is
        // behind, so "apply the schema" resolves the state while advice to edit
        // the collection destroys it.
        const message = bootMessage();
        const apply = message.indexOf("rebase db push");
        const perDefect = message.indexOf("•");

        expect(apply).toBeGreaterThan(-1);
        expect(perDefect).toBeGreaterThan(-1);
        expect(apply).toBeLessThan(perDefect);
    });

    it("names the legacy and the derived column when it can tell them apart", () => {
        const message = bootMessage();

        expect(message).toMatch(/still has `categorie_id`/);
        expect(message).toMatch(/derives `category_id`/);
    });

    it("still names the column the database actually has", () => {
        expect(bootMessage()).toMatch(/categorie_id/);
    });

    it("never advises pinning the column that is about to be renamed", () => {
        expect(bootMessage()).not.toMatch(/set `through\.\w+` to one of/);
    });
});
