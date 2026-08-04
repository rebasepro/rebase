import { pgTable, text } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";

import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { assertRelationsResolve } from "../src/collections/validate-relations";

/**
 * What the boot error tells you when a relation names a column the schema lacks.
 *
 * This check reads the project's generated Drizzle schema —
 * `backend/src/schema.generated.ts` — and called it "the database schema". The
 * two are the same thing right up until they are not, and the case where they
 * diverge is the one that matters: a 0.12 → 0.13 upgrade renames a junction
 * foreign key *in the database* (`categorie_id` → `category_id`, a plural slug
 * singularised), preserves the rows, and then boot dies here on every restart,
 * because the checked-in file still declares the old name.
 *
 * The message said the column "is not a column on the junction table" and
 * offered `fix: set through.targetColumn to one of: product_id, categorie_id`.
 * The database *has* `category_id`. So it described a schema that was not the
 * database, and its remedy named a column that no longer exists — following it
 * turns a recoverable state into a broken config, which is the whole of
 * class 5.
 */

// The junction exactly as 0.12 generated it: the pre-rename spelling.
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

// The config after the upgrade: correct, and newer than the generated file.
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

describe("relation validation against a stale generated schema", () => {
    it("still refuses to boot on a relation it cannot resolve", () => {
        expect(boot).toThrow();
    });

    it("does not claim to have read the database", () => {
        // It read a generated file. Saying "the database schema" is what sent
        // people to edit a config that was already correct.
        expect(bootMessage()).not.toMatch(/against the database schema/);
    });

    it("names the file it actually read", () => {
        expect(bootMessage()).toMatch(/schema\.generated\.ts/);
    });

    it("offers regeneration before the per-relation detail", () => {
        // The ordering is the fix. After a rename the config is right and the
        // file is stale, so "regenerate" resolves the state while advice to
        // edit the collection destroys it.
        //
        // Anchored on the bullet that opens the per-defect list rather than on
        // the old "set `targetColumn` to one of …" wording: this release also
        // *detects* the stale-codegen case and replaces that generic advice
        // with a targeted explanation, so the phrase it used to check for is
        // correctly gone.
        const message = bootMessage();
        const regenerate = message.indexOf("rebase schema generate");
        const perDefect = message.indexOf("•");

        expect(regenerate).toBeGreaterThan(-1);
        expect(perDefect).toBeGreaterThan(-1);
        expect(regenerate).toBeLessThan(perDefect);
    });

    it("names the legacy and the derived column when it can tell them apart", () => {
        // The targeted half, which arrived on main while this branch was
        // fixing the generic half. Together they say what happened and what to
        // do; neither alone did.
        const message = bootMessage();

        expect(message).toMatch(/still declares `categorie_id`/);
        expect(message).toMatch(/derives `category_id`/);
    });

    it("still names the column the generated schema actually has", () => {
        expect(bootMessage()).toMatch(/categorie_id/);
    });
});
