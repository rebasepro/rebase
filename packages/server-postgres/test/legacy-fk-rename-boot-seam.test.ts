/**
 * The seam between the two suites that both passed while the upgrade was broken.
 *
 * `legacy-foreign-key-detection.test.ts` proves the ensure *plan* emits a RENAME
 * when a database carries `categorie_id` and the current rule wants
 * `category_id`. `validate-relations.test.ts` proves `assertRelationsResolve`
 * reports a junction column that does not exist. Both are correct. Neither
 * covers the state an upgrade actually produces, because each builds its own
 * input by hand and so never lets the two sources of truth disagree.
 *
 * There used to be three of them, and that was the bug: the DATABASE, the
 * collections, and the project's checked-in `backend/src/schema.generated.ts`.
 * `assertRelationsResolve` read the third — `registry.getTable()` returned a
 * Drizzle table from the generated module — so on the first boot after
 * `pnpm install`, boot-ensure renamed the column and then the boot died on a
 * column that *did* exist, advising the developer to pin the name that had just
 * been migrated away. There are two sources of truth now: the registry's tables
 * are read from `information_schema`, so a stale file cannot refuse a boot.
 *
 * What is left is the state this fixture describes: a database that has NOT
 * been renamed (nothing provisioned it) against a config that derives the new
 * name. The diagnosis still has to distinguish it from a typo'd column, because
 * the two have opposite fixes — wait for the rename, or edit the relation.
 */
import { pgTable, text } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { generateForeignKeyName, legacyForeignKeyName } from "@rebasepro/utils";

import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { findRelationDefects, assertRelationsResolve } from "../src/collections/validate-relations";

// ── The collections, as 0.13 reads them ──────────────────────────────────────

const categories: CollectionConfig = {
    slug: "categories",
    table: "categories",
    name: "Categories",
    properties: { id: { name: "ID", type: "string", isId: "uuid" }, name: { type: "string" } }
} as unknown as CollectionConfig;

/**
 * A many-to-many, because that is where the rename lands: a junction column's
 * default name comes from the endpoint collection's *slug*, and slugs are
 * plural. `belongsTo` derives from the relation name, which is normally already
 * singular.
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

const CURRENT = generateForeignKeyName("categories");   // category_id
const LEGACY = legacyForeignKeyName("categories");      // categorie_id

/**
 * A registry whose junction table is the one the PREVIOUS release created.
 *
 * This is the whole point of the fixture: the database still carries the old
 * column, and the catalogue-built table the validator reads says so.
 */
function registryFromGeneratedSchema(junctionColumn: string): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple(collections);
    registry.registerTable(
        pgTable("products", { id: text("id").primaryKey(), title: text("title") }) as never,
        "products"
    );
    registry.registerTable(
        pgTable("categories", { id: text("id").primaryKey(), name: text("name") }) as never,
        "categories"
    );
    registry.registerTable(
        pgTable("categories_products", {
            product_id: text("product_id"),
            [junctionColumn]: text(junctionColumn)
        }) as never,
        "categories_products"
    );
    return registry;
}

describe("a database left behind by the FK singularization rename", () => {
    it("is a different fixture from the current one — otherwise this file proves nothing", () => {
        // Guards the test, not the product: if `singular()` ever changes so that
        // `categories` no longer moves, every assertion below would pass against
        // an unbroken fixture and report a gate that ran on nothing.
        expect(LEGACY).toBe("categorie_id");
        expect(CURRENT).toBe("category_id");
        expect(LEGACY).not.toBe(CURRENT);
    });

    it("still resolves cleanly once the rename has been applied", () => {
        const registry = registryFromGeneratedSchema(CURRENT);
        expect(findRelationDefects(collections, registry)).toEqual([]);
        expect(() => assertRelationsResolve(collections, registry)).not.toThrow();
    });

    describe("while it is still stale", () => {
        const registry = () => registryFromGeneratedSchema(LEGACY);

        it("is reported as an unapplied rename, not as a bad column name", () => {
            const [defect] = findRelationDefects(collections, registry());

            expect(defect).toBeDefined();
            expect(defect.collection).toBe("products");
            expect(defect.relationName).toBe("categories");
            // The database is the thing that is behind, and the message has to
            // say so — the collection already names the new column.
            expect(defect.problem).toMatch(/database/i);
            expect(defect.problem).toContain(LEGACY);
            expect(defect.problem).toContain(CURRENT);
        });

        it("names the command that fixes it", () => {
            const [defect] = findRelationDefects(collections, registry());
            expect(defect.fix).toContain("rebase db push");
        });

        it("never advises writing the migrated-away column into the collection", () => {
            const [defect] = findRelationDefects(collections, registry());

            // The old message said: set `through.targetColumn` to one of:
            // `product_id`, `categorie_id`. That column no longer exists in the
            // database, so taking the advice breaks the relation for good.
            expect(defect.fix).not.toMatch(/through\.targetColumn.*categorie_id/s);
            expect(defect.fix).not.toMatch(/set `through\.\w+` to one of/);
        });

        it("does not advise writing the migrated-away column into the collection", () => {
            let message = "";
            try {
                assertRelationsResolve(collections, registry());
            } catch (e) {
                message = (e as Error).message;
            }

            expect(message).not.toBe("");
            // The boot still fails — that part was right, an unresolvable
            // relation must not serve empty results. What it must not do is
            // describe a database it never read.
            expect(message).not.toMatch(new RegExp(`\`through\\.targetColumn: "${CURRENT}"\` is not a column`));
            expect(message).toMatch(/rebase db push/);
        });
    });
});
