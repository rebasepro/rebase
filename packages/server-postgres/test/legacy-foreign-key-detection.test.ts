/**
 * Detecting a database provisioned before `generateForeignKeyName` singularized.
 *
 * The old rule snake-cased a collection name and chopped one trailing "s", so
 * `categories` produced `categorie_id`. The current rule produces
 * `category_id`. Only irregular plurals moved — `posts`, `users` and
 * `products` are spelled the same either way, which is most projects.
 *
 * The reason this needs detecting at all is the shape of the failure. Boot-time
 * ensure is additive by design: it creates what is missing and never drops or
 * renames. Faced with a table that has a populated `categorie_id` and a
 * collection that now asks for `category_id`, it does exactly what it is
 * supposed to — adds the missing column — and every statement succeeds. The
 * relation then reads the column that was created empty a moment ago, beside
 * the one holding the data. No error, no failed migration, no missing table.
 * The only symptom is relations resolving to nothing, which looks identical to
 * having no data.
 *
 * So the plan carries the collision out to the caller, and `ensureCollectionTables`
 * says so before it applies anything.
 */
import { CollectionConfig } from "@rebasepro/types";
import { generateForeignKeyName, legacyForeignKeyName } from "@rebasepro/utils";
import { planCollectionSchemaEnsure, type ExistingSchema } from "../src/schema/ensure-collection-tables";

const categories: CollectionConfig = {
    slug: "categories",
    table: "categories",
    name: "Categories",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { type: "string" }
    }
} as unknown as CollectionConfig;

/**
 * A many-to-many, because that is where the change actually lands. A junction
 * column's default name is derived from the endpoint collection's *slug* — and
 * slugs are plural, so `categories` is exactly the shape that moved. A
 * `belongsTo` derives from the relation name, which is normally singular and
 * so unaffected.
 */
const products: CollectionConfig = {
    slug: "products",
    table: "products",
    name: "Products",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { type: "string" },
        categories: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => categories, relationName: "categories" }
        }
    }
} as unknown as CollectionConfig;

const collections = [products, categories];

/** The junction the pair above implies, carrying the given columns. */
const dbWithJunction = (columns: string[]): ExistingSchema => ({
    tables: new Map([
        ["public.products", new Set(["id", "title"])],
        ["public.categories", new Set(["id", "name"])],
        ["public.categories_products", new Set(columns)]
    ]),
    enums: new Set(),
    constraints: new Set()
});

describe("legacy foreign-key column detection", () => {
    it("pins the two spellings this is about", () => {
        // If these ever agree, the whole detection is dead code and should go.
        expect(generateForeignKeyName("categories")).toBe("category_id");
        expect(legacyForeignKeyName("categories")).toBe("categorie_id");
        // ...and the regular plural that must never be flagged.
        expect(generateForeignKeyName("products")).toBe(legacyForeignKeyName("products"));
    });

    it("reports a junction that has the old spelling and not the new one", () => {
        const plan = planCollectionSchemaEnsure(collections, dbWithJunction(["categorie_id", "product_id"]));

        expect(plan.legacyForeignKeys).toEqual([
            { table: "public.categories_products", expected: "category_id", legacy: "categorie_id" }
        ]);

        // It still plans the column: the report is a warning, not a veto.
        // Refusing to add it would leave the relation with no column at all,
        // which is worse than one the operator has been told about.
        expect(plan.statements.some(s => s.includes('ADD COLUMN IF NOT EXISTS "category_id"'))).toBe(true);
    });

    it("says nothing when the junction already has the current spelling", () => {
        const plan = planCollectionSchemaEnsure(collections, dbWithJunction(["category_id", "product_id"]));
        expect(plan.legacyForeignKeys).toEqual([]);
    });

    it("says nothing when both spellings are present", () => {
        // Migrated by hand, or the old column deliberately left behind. The
        // relation reads a column that exists, so there is nothing to say.
        const plan = planCollectionSchemaEnsure(
            collections,
            dbWithJunction(["category_id", "categorie_id", "product_id"])
        );
        expect(plan.legacyForeignKeys).toEqual([]);
    });

    it("says nothing for a junction it is creating from scratch", () => {
        // No junction table at all: nothing to strand.
        const plan = planCollectionSchemaEnsure(collections, {
            tables: new Map([
                ["public.products", new Set(["id", "title"])],
                ["public.categories", new Set(["id", "name"])]
            ]),
            enums: new Set(),
            constraints: new Set()
        });
        expect(plan.legacyForeignKeys).toEqual([]);
    });

    it("never flags the endpoint whose spelling did not change", () => {
        // `products` gives `product_id` under both rules. Even with the old
        // column absent it must not appear — otherwise every m2m in every
        // project would warn.
        const plan = planCollectionSchemaEnsure(collections, dbWithJunction(["categorie_id"]));
        expect(plan.legacyForeignKeys.map(l => l.expected)).toEqual(["category_id"]);
    });

    it("says nothing when the author named the junction columns themselves", () => {
        // An explicit `through` is not derived, so the rule change cannot have
        // moved it — and note the name chosen here IS the legacy spelling,
        // which is exactly how an affected project is meant to pin it.
        const pinned: CollectionConfig = {
            ...products,
            properties: {
                ...products.properties,
                categories: {
                    type: "relation",
                    relation: {
                        kind: "manyToMany",
                        target: () => categories,
                        relationName: "categories",
                        through: {
                            table: "categories_products",
                            sourceColumn: "product_id",
                            targetColumn: "categorie_id"
                        }
                    }
                }
            }
        } as unknown as CollectionConfig;

        const plan = planCollectionSchemaEnsure([pinned, categories], dbWithJunction(["categorie_id", "product_id"]));
        expect(plan.legacyForeignKeys).toEqual([]);
    });

    /**
     * The discriminating case for the "was this name derived?" guard.
     *
     * Above, the author's chosen name happens to equal the legacy one, so the
     * column is already present and the check short-circuits — it passes
     * whether or not the guard exists. Here the author picks a third name that
     * is absent while the legacy column is present, which is the only shape
     * where the guard is what decides. Dropping it makes this warn about a
     * database whose owner has already told us what the column is called.
     */
    it("stays quiet when an author-named column is missing and the old one is not", () => {
        const renamed: CollectionConfig = {
            ...products,
            properties: {
                ...products.properties,
                categories: {
                    type: "relation",
                    relation: {
                        kind: "manyToMany",
                        target: () => categories,
                        relationName: "categories",
                        through: {
                            table: "categories_products",
                            sourceColumn: "product_id",
                            targetColumn: "cat_ref"
                        }
                    }
                }
            }
        } as unknown as CollectionConfig;

        const plan = planCollectionSchemaEnsure([renamed, categories], dbWithJunction(["categorie_id", "product_id"]));

        expect(plan.legacyForeignKeys).toEqual([]);
        // The author's column is genuinely missing, so it is still created.
        expect(plan.statements.some(s => s.includes('ADD COLUMN IF NOT EXISTS "cat_ref"'))).toBe(true);
    });
});
