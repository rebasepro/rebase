/**
 * The boot-time diff between `schema.generated.ts` and the live catalogue.
 *
 * The runtime serves the catalogue, so none of these differences change what a
 * request does. They still matter — Atlas plans migrations from that file,
 * `db push` diffs it, `eject` writes it out and user code imports it — so a
 * project whose file has fallen behind should hear it once at boot rather than
 * later, in a tool, with no clue that anything was known.
 */
import { describe, expect, it } from "@jest/globals";
import { boolean, integer, numeric, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import {
    diffGeneratedSchemaAgainstCatalogue,
    describeSchemaDifference,
    typeFamily
} from "../src/schema/generated-schema-diff";
import { buildTablesMap, type TableColumn } from "../src/schema/introspect-db-logic";

function column(overrides: Partial<TableColumn> & { table_name: string; column_name: string }): TableColumn {
    return {
        data_type: "text",
        udt_name: "text",
        is_nullable: "YES",
        column_default: null,
        atttypmod: null,
        ...overrides
    };
}

function catalogueOf(columns: TableColumn[]) {
    const tables = [...new Set(columns.map(c => c.table_name))].map(table_name => ({ table_name }));
    return buildTablesMap(tables, columns, [], []);
}

const posts = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        authorId: { name: "Author", type: "string", columnName: "author_id" }
    }
} as unknown as CollectionConfig;

const generated = {
    posts: pgTable("posts", {
        id: uuid("id").primaryKey(),
        title: text("title").notNull(),
        authorId: uuid("author_id")
    })
};

const catalogue = catalogueOf([
    column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
    column({ table_name: "posts", column_name: "title", is_nullable: "NO" }),
    column({ table_name: "posts", column_name: "author_id", data_type: "uuid", udt_name: "uuid" })
]);

describe("diffGeneratedSchemaAgainstCatalogue", () => {
    it("reports nothing when the file describes the database", () => {
        expect(diffGeneratedSchemaAgainstCatalogue({
            generated,
            catalogue,
            collections: [posts]
        })).toEqual([]);
    });

    it("says nothing at all when no module was loaded", () => {
        expect(diffGeneratedSchemaAgainstCatalogue({
            generated: undefined,
            catalogue,
            collections: [posts]
        })).toEqual([]);
    });

    it("names the collection, the property and the column of a missing column", () => {
        const [difference, ...rest] = diffGeneratedSchemaAgainstCatalogue({
            generated: {
                posts: pgTable("posts", {
                    id: uuid("id").primaryKey(),
                    title: text("title").notNull(),
                    authorId: uuid("author_id"),
                    subtitle: text("subtitle")
                })
            },
            catalogue,
            collections: [posts]
        });

        expect(rest).toEqual([]);
        expect(difference).toMatchObject({
            kind: "missing-column",
            table: "posts",
            collection: "posts",
            column: "subtitle"
        });
        expect(describeSchemaDifference(difference)).toContain("posts");
    });

    it("reports a column the database has and the file does not, by its wire name", () => {
        const withExtra = catalogueOf([
            column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column({ table_name: "posts", column_name: "title", is_nullable: "NO" }),
            column({ table_name: "posts", column_name: "author_id", data_type: "uuid", udt_name: "uuid" }),
            column({ table_name: "posts", column_name: "published_at", data_type: "timestamp with time zone", udt_name: "timestamptz" })
        ]);

        const differences = diffGeneratedSchemaAgainstCatalogue({ generated, catalogue: withExtra, collections: [posts] });

        expect(differences).toEqual([expect.objectContaining({
            kind: "extra-column",
            column: "published_at",
            property: "publishedAt",
            live: "timestamptz"
        })]);
    });

    it("reports a type that changed family", () => {
        const asText = catalogueOf([
            column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column({ table_name: "posts", column_name: "title", is_nullable: "NO" }),
            column({ table_name: "posts", column_name: "author_id", data_type: "text", udt_name: "text" })
        ]);

        expect(diffGeneratedSchemaAgainstCatalogue({ generated, catalogue: asText, collections: [posts] }))
            .toEqual([expect.objectContaining({
                kind: "type",
                column: "author_id",
                property: "authorId",
                generated: "uuid",
                live: "text"
            })]);
    });

    it("reports nullability, in both directions", () => {
        const nullableTitle = catalogueOf([
            column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column({ table_name: "posts", column_name: "title", is_nullable: "YES" }),
            column({ table_name: "posts", column_name: "author_id", data_type: "uuid", udt_name: "uuid" })
        ]);

        expect(diffGeneratedSchemaAgainstCatalogue({ generated, catalogue: nullableTitle, collections: [posts] }))
            .toEqual([expect.objectContaining({
                kind: "nullability",
                column: "title",
                generated: "NOT NULL",
                live: "nullable"
            })]);
    });

    it("reports a table the file has and the database does not", () => {
        expect(diffGeneratedSchemaAgainstCatalogue({
            generated,
            catalogue: new Map(),
            collections: [posts]
        })).toEqual([expect.objectContaining({ kind: "missing-table", table: "posts", collection: "posts" })]);
    });

    it("stays quiet about a table that belongs to another data source", () => {
        // The module carries every table the project declares, including the
        // ones a second database holds. Those are legitimately absent here.
        expect(diffGeneratedSchemaAgainstCatalogue({
            generated: { events: pgTable("events", { id: text("id").primaryKey() }) },
            catalogue,
            collections: [posts]
        })).toEqual([]);
    });

    it("stays quiet about the auth columns the generator deliberately omits", () => {
        // A brand-new scaffold booted with seven differences on `users`, all of
        // them by design: `render-drizzle` drops the columns a users collection
        // does not declare (drizzle-kit creates no auth table), and the
        // collection's properties say nothing about the `NOT NULL DEFAULT`
        // `ensureAuthTablesExist` applies. The remedy the warning printed —
        // `rebase schema generate` — regenerates from the same collection and
        // changes none of them, so the warning survived its own fix on every
        // boot forever.
        const users = {
            slug: "users",
            table: "users",
            name: "Users",
            auth: true,
            properties: { id: { type: "string", isId: "uuid" }, roles: { type: "array", of: { type: "string" } } }
        } as unknown as CollectionConfig;

        const differences = diffGeneratedSchemaAgainstCatalogue({
            generated: {
                users: pgTable("users", {
                    id: uuid("id").primaryKey(),
                    // nullable in the file, NOT NULL in the database
                    roles: text("roles").array()
                })
            },
            catalogue: catalogueOf([
                column({ table_name: "users", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "users", column_name: "roles", data_type: "ARRAY", udt_name: "_text", is_nullable: "NO" }),
                // present in the database, absent from the file, on purpose
                column({ table_name: "users", column_name: "is_anonymous", data_type: "boolean", udt_name: "bool", is_nullable: "NO" }),
                column({ table_name: "users", column_name: "tokens_valid_after", data_type: "timestamp with time zone", udt_name: "timestamptz" })
            ]),
            collections: [users]
        });
        expect(differences).toEqual([]);
    });

    it("still reports a column the developer added to the users collection", () => {
        // The carve-out is auth's own columns, not the whole table: a field the
        // developer declared and then dropped from the database is still drift.
        const users = {
            slug: "users", table: "users", name: "Users", auth: true,
            properties: { id: { type: "string", isId: "uuid" }, bio: { type: "string" } }
        } as unknown as CollectionConfig;

        const differences = diffGeneratedSchemaAgainstCatalogue({
            generated: { users: pgTable("users", { id: uuid("id").primaryKey(), bio: text("bio") }) },
            catalogue: catalogueOf([
                column({ table_name: "users", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "users", column_name: "stripe_customer_id", data_type: "text", udt_name: "text" })
            ]),
            collections: [users]
        });
        expect(differences).toEqual([
            expect.objectContaining({ kind: "missing-column", column: "bio" }),
            expect.objectContaining({ kind: "extra-column", column: "stripe_customer_id" })
        ]);
    });

    it("does not report a width or a synonym as drift", () => {
        // `varchar(120)` and `text` behave identically here and Postgres still
        // enforces the width. A warning on every boot of a correct project is
        // worse than no warning at all.
        const widths = catalogueOf([
            column({ table_name: "widths", column_name: "a", data_type: "text", udt_name: "text" }),
            column({ table_name: "widths", column_name: "b", data_type: "integer", udt_name: "int4" }),
            column({ table_name: "widths", column_name: "c", data_type: "numeric", udt_name: "numeric" }),
            column({ table_name: "widths", column_name: "d", data_type: "timestamp with time zone", udt_name: "timestamptz" })
        ]);

        expect(diffGeneratedSchemaAgainstCatalogue({
            generated: {
                widths: pgTable("widths", {
                    a: varchar("a", { length: 120 }),
                    b: integer("b"),
                    c: numeric("c", { precision: 10, scale: 2 }),
                    d: timestamp("d", { withTimezone: true, mode: "string" })
                })
            },
            catalogue: widths,
            collections: []
        })).toEqual([]);
    });
});

describe("typeFamily", () => {
    it("groups the string types, and keeps the numeric ones apart", () => {
        expect(typeFamily("varchar(255)")).toBe("text");
        expect(typeFamily("bpchar")).toBe("text");
        expect(typeFamily("character varying")).toBe("text");
        expect(typeFamily("numeric")).not.toBe(typeFamily("double precision"));
        expect(typeFamily("int4")).toBe(typeFamily("integer"));
        expect(typeFamily("int8")).not.toBe(typeFamily("int4"));
    });

    it("distinguishes a timestamp from a timestamptz, and an array from its element", () => {
        expect(typeFamily("timestamp")).not.toBe(typeFamily("timestamptz"));
        expect(typeFamily("timestamp with time zone")).toBe(typeFamily("timestamptz"));
        expect(typeFamily("_text")).toBe("text[]");
        expect(typeFamily("text[]")).toBe("text[]");
        expect(typeFamily("text[]")).not.toBe(typeFamily("text"));
    });

    it("passes an enum through by name, so two spellings of one enum match", () => {
        expect(typeFamily("post_status")).toBe("post_status");
    });
});
