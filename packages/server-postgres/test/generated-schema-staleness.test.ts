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
import { staleVerdict } from "../src/schema/generated-schema-staleness";

import { findLegacyForeignKeyNames, findMissingGeneratedNames } from "../src/schema/generated-schema-staleness";

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

/**
 * The other way a generated schema goes stale, and the blind spot both checks
 * shared.
 *
 * The rename above is the subtle failure: nothing the developer owns changed.
 * This is the ordinary one — a collection or relation was added and the
 * generator was not re-run — plus the reason neither check could see a table
 * outside `public`.
 */
describe("findMissingGeneratedNames", () => {
    /** A `belongsTo`, whose derived column lives on the source table. */
    const authors: CollectionConfig = {
        slug: "authors",
        table: "authors",
        name: "Authors",
        // `schema` is the point of the last test below: an auth collection is
        // written this way in every scaffold.
        schema: "rebase",
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;

    const articles: CollectionConfig = {
        slug: "articles",
        table: "articles",
        name: "Articles",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            author: {
                type: "relation",
                relation: { kind: "belongsTo", target: () => authors, relationName: "author" }
            }
        }
    } as unknown as CollectionConfig;

    const collections = [articles, authors];

    const AUTHORS_TABLE = `export const authors = rebaseSchema.table("authors", { id: text("id") });`;
    const ARTICLES_WITH_FK =
        `export const articles = pgTable("articles", { id: text("id"), authorId: text("author_id") });`;
    const ARTICLES_WITHOUT_FK = `export const articles = pgTable("articles", { id: text("id") });`;

    it("reports a table the generated schema does not declare", () => {
        const found = findMissingGeneratedNames(AUTHORS_TABLE, collections);

        expect(found).toContainEqual(expect.objectContaining({ table: "articles", source: "articles" }));
    });

    it("reports a derived foreign-key column the table does not declare", () => {
        const found = findMissingGeneratedNames(`${ARTICLES_WITHOUT_FK}\n${AUTHORS_TABLE}`, collections);

        expect(found).toContainEqual(
            expect.objectContaining({ table: "articles", column: "author_id" })
        );
    });

    it("says nothing when everything is declared", () => {
        expect(findMissingGeneratedNames(`${ARTICLES_WITH_FK}\n${AUTHORS_TABLE}`, collections)).toEqual([]);
    });

    it("sees a table declared through a schema, not only through pgTable", () => {
        // The blind spot this closes. `rebaseSchema.table("authors", …)` is how
        // every scaffold's auth collection is written, and matching only
        // `pgTable(` reported it absent — which also meant the *rename* check
        // never inspected a single table outside `public`.
        const found = findMissingGeneratedNames(`${ARTICLES_WITH_FK}\n${AUTHORS_TABLE}`, collections);

        expect(found.map(f => f.table)).not.toContain("authors");
    });

    it("reports an absent table once, not once per column it would have held", () => {
        const found = findMissingGeneratedNames(AUTHORS_TABLE, collections);

        expect(found.filter(f => f.table === "articles")).toHaveLength(1);
    });
});

/**
 * What `rebase schema stale` says — which, for three of its four paths, was
 * nothing at all: exit 0, zero bytes on stdout, zero on stderr, for a command
 * the top-level help describes as "Report generated schema files the
 * collections have moved past". Indistinguishable from a no-op, from a crash,
 * and from a subcommand the driver does not implement.
 */
describe("the verdict schema stale prints", () => {
    const OUTPUT = "src/schema.generated.ts";
    const clean = { outputPath: OUTPUT, generatedExists: true, stale: [], fix: false };
    const behind = [{ table: "articles", column: "categorie_id", expected: "category_id" }] as never;
    const said = (input: Parameters<typeof staleVerdict>[0]) => staleVerdict(input).lines.join("\n");

    it("says so when nothing is stale", () => {
        const verdict = staleVerdict(clean);

        expect(verdict.lines.join("\n")).toContain("Nothing stale");
        expect(verdict.lines.join("\n")).toContain(OUTPUT);
        expect(verdict.exitCode).toBe(0);
        expect(verdict.regenerate).toBe(false);
    });

    it("never exits 0 with nothing to show for it", () => {
        // The vacuity assertion, over every path a person can reach.
        const paths = [
            clean,
            { ...clean, generatedExists: false },
            { ...clean, unreadable: "Cannot find module './authors'" },
            { ...clean, stale: behind }
        ];

        for (const input of paths) {
            expect(staleVerdict(input).lines.filter(Boolean).length).toBeGreaterThan(0);
        }
    });

    it("does not call a missing generated schema stale", () => {
        // A fresh project has not run the generator. Saying "stale" about a file
        // that does not exist sends the reader looking for something to fix.
        const printed = said({ ...clean, generatedExists: false });

        expect(printed).not.toContain("stale");
        expect(printed).toContain("rebase schema generate");
        expect(staleVerdict({ ...clean, generatedExists: false }).exitCode).toBe(0);
    });

    it("says a comparison it could not make was not made", () => {
        const printed = said({ ...clean, unreadable: "Cannot find module './authors'" });

        expect(printed).toContain("Not checked");
        expect(printed).toContain("Cannot find module");
    });

    it("fails, and says why, when the generated schema is behind", () => {
        const verdict = staleVerdict({ ...clean, stale: behind });

        expect(verdict.exitCode).toBe(1);
        expect(verdict.lines.join("\n")).toContain("refuse to start");
        expect(verdict.lines.join("\n")).toContain("rebase schema generate");
    });

    it("stays silent under --fix when there is nothing to fix", () => {
        // `rebase dev` runs `schema stale --fix` before every boot with
        // inherited stdio. "Nothing was wrong" is not news a hundred lines into
        // a start-up transcript; the flag is the automated caller's.
        expect(staleVerdict({ ...clean, fix: true }).lines).toEqual([]);
        expect(staleVerdict({ ...clean, generatedExists: false, fix: true }).lines).toEqual([]);
    });

    it("still speaks under --fix when there is something to fix", () => {
        const verdict = staleVerdict({ ...clean, fix: true, stale: behind });

        expect(verdict.regenerate).toBe(true);
        expect(verdict.exitCode).toBe(0);
        expect(verdict.lines.join("\n")).toContain("Regenerating");
    });
});
