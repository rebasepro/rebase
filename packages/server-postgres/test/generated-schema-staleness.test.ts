/**
 * Detecting a generated Drizzle schema that a library upgrade invalidated.
 *
 * `rebase dev` already warns about drift when a *collection file* changes, and
 * `--generate` regenerates on start. Neither helps here, because the thing that
 * changed is inside the framework: 0.13 derives `category_id` where 0.12 derived
 * `categorie_id`, from the same unedited collection. No file the watcher looks
 * at was touched, so nothing fires, and the checked-in
 * `backend/src/schema.generated.ts` silently stops describing the schema the
 * runtime expects.
 *
 * That combination is fatal rather than cosmetic: boot-ensure renames the column
 * in the database, then relation validation reads the stale module and refuses
 * to start — on every boot from then on. See
 * `legacy-fk-rename-boot-seam.test.ts` for that half.
 *
 * So the upgrade needs something that notices. This is deliberately narrow: it
 * answers "does this generated schema name a foreign key the way the previous
 * rule did", not "is this file byte-identical to what we would generate now".
 * The wide question would flag every formatting change as a fatal staleness and
 * make the check impossible to leave switched on.
 */
import { CollectionConfig } from "@rebasepro/types";
import { generateForeignKeyName, legacyForeignKeyName } from "@rebasepro/utils";

import { findLegacyForeignKeyNames } from "../src/schema/generated-schema-staleness";

// ── Collections ──────────────────────────────────────────────────────────────

const categories: CollectionConfig = {
    slug: "categories",
    table: "categories",
    name: "Categories",
    properties: { id: { name: "ID", type: "string", isId: "uuid" }, name: { type: "string" } }
} as unknown as CollectionConfig;

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

/** A pair whose derived names do NOT move — the common case, and the false-positive risk. */
const tags: CollectionConfig = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
} as unknown as CollectionConfig;

const posts: CollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        tags: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => tags, relationName: "tags" }
        }
    }
} as unknown as CollectionConfig;

const LEGACY = legacyForeignKeyName("categories");    // categorie_id
const CURRENT = generateForeignKeyName("categories"); // category_id

/** The junction block 0.12's generator emitted, near enough for a text scan. */
const generatedWith = (junctionColumn: string) => `
import { pgTable, text, primaryKey } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
    id: text("id").primaryKey(),
    title: text("title")
});

export const categories = pgTable("categories", {
    id: text("id").primaryKey(),
    name: text("name")
});

export const categoriesProducts = pgTable("categories_products", {
    product_id: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    ${junctionColumn}: text("${junctionColumn}").notNull().references(() => categories.id, { onDelete: "cascade" })
}, (table) => [
    primaryKey({ columns: [table.product_id, table.${junctionColumn}] })
]);
`;

describe("findLegacyForeignKeyNames", () => {
    it("has a fixture whose name actually moved", () => {
        // Without this the whole file could pass against an unbroken input.
        expect(LEGACY).toBe("categorie_id");
        expect(CURRENT).toBe("category_id");
    });

    it("finds the legacy junction column and says what it should be", () => {
        const found = findLegacyForeignKeyNames(generatedWith(LEGACY), [products, categories]);

        expect(found).toHaveLength(1);
        expect(found[0]).toEqual(
            expect.objectContaining({
                table: "categories_products",
                legacy: LEGACY,
                current: CURRENT
            })
        );
    });

    it("says nothing about a schema that has already been regenerated", () => {
        expect(findLegacyForeignKeyNames(generatedWith(CURRENT), [products, categories])).toEqual([]);
    });

    it("says nothing for relations whose derived name never moved", () => {
        // `posts` ⇄ `tags`: both singularize to themselves minus the "s", so the
        // old rule and the new one agree. Most projects are entirely this case,
        // and flagging them would make the check worthless.
        const generated = `
export const postsTags = pgTable("posts_tags", {
    post_id: text("post_id"),
    tag_id: text("tag_id")
});
`;
        expect(findLegacyForeignKeyNames(generated, [posts, tags])).toEqual([]);
    });

    it("does not flag a legacy-looking name the author chose explicitly", () => {
        // An explicit `targetColumn` is the documented opt-out — the rename note
        // says so — and honouring it is the difference between a check that can
        // stay on and one that has to be muted.
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
                        through: { table: "categories_products", sourceColumn: "product_id", targetColumn: LEGACY }
                    }
                }
            }
        } as unknown as CollectionConfig;

        expect(findLegacyForeignKeyNames(generatedWith(LEGACY), [pinned, categories])).toEqual([]);
    });

    it("ignores the legacy name appearing somewhere that is not a column", () => {
        // A comment or a policy expression mentioning the old name must not
        // stand in for a column declaration.
        const generated = `
// migrated away from categorie_id in 0.13
export const categoriesProducts = pgTable("categories_products", {
    product_id: text("product_id"),
    ${CURRENT}: text("${CURRENT}")
});
`;
        expect(findLegacyForeignKeyNames(generated, [products, categories])).toEqual([]);
    });
});
