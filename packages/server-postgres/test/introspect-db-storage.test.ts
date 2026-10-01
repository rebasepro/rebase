/**
 * What introspection writes so that the planner builds the column it read.
 *
 * The end-to-end proof is `e2e/introspect-roundtrip-e2e.test.ts` (introspect,
 * then `db push --dry-run`, against a real Postgres: no changes). These are the
 * per-column answers it is made of, and the two that need a real catalogue —
 * the sequence name Postgres gives a long `SERIAL`, and a search block read
 * back from the expression Postgres deparsed — run against PGlite.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import type { ForeignKeyRow, TableColumn } from "../src/schema/introspect-db-logic";
import {
    arrayStorage,
    columnStorage,
    literalDefaultOf,
    onDeleteOf,
    primaryKeyStorage,
    serialSequenceName
} from "../src/schema/introspect-db-storage";
import { reconstructSearchBlock } from "../src/schema/introspect-db-search";
import { readSchemaMetadata } from "../src/schema/introspect-db-queries";
import { ensureCollectionTables } from "../src/schema/ensure-collection-tables";

const col = (column_name: string, data_type: string, extra: Partial<TableColumn> = {}): TableColumn => ({
    table_name: "things",
    column_name,
    data_type,
    udt_name: data_type,
    is_nullable: "YES",
    column_default: null,
    ...extra
});
const plain = { isEnumColumn: false, enumTypeName: "things_x", enumTypeShared: false };

describe("a column's storage keys", () => {
    it.each([
        [col("n", "integer"), "number", ['columnType: "integer"']],
        [col("n", "bigint"), "number", ['columnType: "bigint"']],
        [col("n", "real"), "number", ['columnType: "real"']],
        [col("n", "double precision"), "number", ['columnType: "double precision"']],
        [col("n", "numeric", { numeric_precision: 10, numeric_scale: 2 }), "number", ["precision: 10", "scale: 2"]],
        [col("n", "numeric"), "number", []],
        [col("s", "text"), "string", []],
        [col("s", "character varying", { character_maximum_length: 40 }), "string", ['columnType: "varchar"']],
        [col("s", "character", { character_maximum_length: 2 }), "string", ['columnType: "char"']],
        [col("s", "uuid"), "string", ['columnType: "uuid"']],
        [col("d", "timestamp with time zone"), "date", []],
        [col("d", "date"), "date", ['columnType: "date"']],
        [col("d", "time without time zone"), "date", ['columnType: "time"']],
        [col("m", "jsonb"), "map", []],
        [col("m", "json"), "map", ['columnType: "json"']]
    ])("%#: %o as %s → %o", (column, propType, keys) => {
        const stored = columnStorage(column, propType, plain);
        expect(stored.keys).toEqual(keys);
        expect(stored.note).toBeUndefined();
    });

    it.each([
        [col("d", "timestamp without time zone"), "date", /timestamptz/],
        [col("t", "interval"), "string", /interval.*converting the column to text/],
        [col("i", "inet"), "string", /inet/],
        [col("s", "character varying"), "string", /no length/],
        [col("n", "money"), "number", /money/]
    ])("%#: says what a push would do to %o", (column, propType, note) => {
        expect(columnStorage(column, propType, plain).note).toMatch(note);
    });

    it("declares a smallint as integer, and says the push widens it", () => {
        const stored = columnStorage(col("n", "smallint"), "number", plain);
        expect(stored.keys).toEqual(['columnType: "integer"']);
        expect(stored.note).toMatch(/widens/);
    });

    it("keeps an enum whose type is named the way Rebase names it, and says how to rename any other", () => {
        const enumCol = col("mood", "USER-DEFINED", { udt_name: "mood" });
        expect(columnStorage({ ...enumCol, udt_name: "things_mood" }, "string",
            { isEnumColumn: true, enumTypeName: "things_mood", enumTypeShared: false })).toEqual({ keys: [] });
        expect(columnStorage(enumCol, "string", { isEnumColumn: true, enumTypeName: "things_mood", enumTypeShared: false }).note)
            .toContain('ALTER TYPE "mood" RENAME TO "things_mood";');
        expect(columnStorage(enumCol, "string", { isEnumColumn: true, enumTypeName: "things_mood", enumTypeShared: true }).note)
            .toMatch(/other columns share/);
    });

    it("stores only the four native array element types natively", () => {
        expect(arrayStorage(col("a", "ARRAY", { udt_name: "_text" }))).toEqual({ columnType: "text[]", innerType: "string" });
        expect(arrayStorage(col("a", "ARRAY", { udt_name: "_int4" }))).toEqual({ columnType: "integer[]", innerType: "number" });
        // Read as integer[] before — a narrowing on the first push.
        expect(arrayStorage(col("a", "ARRAY", { udt_name: "_int8" })).note).toMatch(/array of int8/);
        expect(arrayStorage(col("a", "ARRAY", { udt_name: "_varchar" })).columnType).toBeUndefined();
    });
});

describe("a primary key's isId", () => {
    it("is increment for an integer identity, and only for one", () => {
        expect(primaryKeyStorage(col("id", "integer", { is_identity: "YES" }), "number"))
            .toEqual({ keys: ['isId: "increment"'] });
        expect(primaryKeyStorage(col("id", "bigint", { is_identity: "YES" }), "number").note).toMatch(/always INTEGER/);
    });

    it("declares a serial key as SERIAL, with the sequence Postgres would name", () => {
        expect(primaryKeyStorage(col("id", "integer", { column_default: "nextval('things_id_seq'::regclass)" }), "number"))
            .toEqual({ keys: ['isId: "manual"', 'columnType: "serial"'] });
        expect(primaryKeyStorage(col("id", "bigint", { column_default: "nextval('things_id_seq'::regclass)" }), "number"))
            .toEqual({ keys: ['isId: "manual"', 'columnType: "bigserial"'] });
        expect(primaryKeyStorage(col("id", "integer", { column_default: "nextval('custom_seq'::regclass)" }), "number").note)
            .toMatch(/sequence custom_seq/);
    });

    it("is uuid only when the database generates it, and manual otherwise", () => {
        expect(primaryKeyStorage(col("id", "uuid", { column_default: "gen_random_uuid()" }), "string"))
            .toEqual({ keys: ['isId: "uuid"'] });
        expect(primaryKeyStorage(col("id", "uuid"), "string"))
            .toEqual({ keys: ['isId: "manual"', 'columnType: "uuid"'] });
        expect(primaryKeyStorage(col("code", "text"), "string")).toEqual({ keys: ['isId: "manual"'] });
        expect(primaryKeyStorage(col("id", "uuid", { column_default: "my_id()" }), "string").keys[0])
            .toBe('isId: "sql`my_id()`"');
    });
});

describe("a column default", () => {
    it.each([
        ["'user'::text", "string", '"user"'],
        ["'it''s'::character varying", "string", "\"it's\""],
        ["'new'::people_status", "string", '"new"'],
        ["0", "number", "0"],
        ["'1.50'::numeric", "number", "1.5"],
        ["(-3)", "number", "-3"],
        ["true", "boolean", "true"],
        ["'{\"a\": 1}'::jsonb", "map", '{"a":1}']
    ])("%s on a %s is defaultValue %s", (fallback, propType, source) => {
        expect(literalDefaultOf(col("c", "text", { column_default: fallback }), propType)).toEqual({ source });
    });

    it("leaves now() to autoValue", () => {
        expect(literalDefaultOf(col("c", "timestamp with time zone", { column_default: "now()" }), "date")).toBeUndefined();
    });

    it("says when a default cannot be carried, rather than dropping it unannounced", () => {
        expect(literalDefaultOf(col("c", "date", { column_default: "CURRENT_DATE" }), "date"))
            .toEqual({ note: expect.stringMatching(/CURRENT_DATE.*dropping that default/) });
    });
});

describe("ON DELETE", () => {
    const fk = (delete_rule: string): ForeignKeyRow => ({
        table_name: "orders", column_name: "customer_id", foreign_table_name: "customers", foreign_column_name: "id", delete_rule
    });
    it("is written only when it is not what the planner would choose", () => {
        expect(onDeleteOf(fk("SET NULL"), false)).toBeUndefined();
        expect(onDeleteOf(fk("RESTRICT"), true)).toBeUndefined();
        expect(onDeleteOf(fk("CASCADE"), true)).toBe("cascade");
        expect(onDeleteOf(fk("NO ACTION"), false)).toBe("no action");
    });
});

describe("against a real catalogue", () => {
    let db: PGlite;
    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
    });
    afterEach(async () => {
        await db.close();
    });

    it("names a SERIAL's sequence the way Postgres does, long table names included", async () => {
        const table = "a_table_with_a_really_long_name_that_goes_on_and_on_and_on_fore";
        await db.exec(`CREATE TABLE "${table}" (id serial PRIMARY KEY); CREATE TABLE short_one (id serial PRIMARY KEY);`);
        for (const name of [table, "short_one"]) {
            const res = await db.query<{ seq: string }>(`SELECT pg_get_serial_sequence('"${name}"', 'id') AS seq`);
            expect(`public.${serialSequenceName(name, "id")}`).toBe(res.rows[0].seq.replace(/"/g, ""));
        }
    });

    it("reads a search block back from the column it built, checked against its stamp", async () => {
        const posts = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            search: { language: "english", fields: [{ path: "title", weight: "A" }, { path: "body", weight: "C" }] },
            properties: {
                id: { type: "string", isId: "uuid" },
                title: { type: "string" },
                body: { type: "string" }
            }
        } as unknown as CollectionConfig;
        await ensureCollectionTables(db, [posts]);
        const metadata = await readSchemaMetadata(db, "public");
        const columns = metadata.columns.filter(c => c.table_name === "posts");
        const comments = new Map(metadata.comments
            .filter(c => c.table_name === "posts" && c.column_name)
            .map(c => [c.column_name as string, c.comment]));
        const keyByColumn = new Map([["id", "id"], ["title", "title"], ["body", "body"]]);

        const read = reconstructSearchBlock({ schema: "public", table: "posts", columns, comments, keyByColumn });
        expect(read.note).toBeUndefined();
        expect(read.columns).toEqual(new Set(["search_vector"]));
        expect(read.block).toContain('language: "english"');
        expect(read.block).toContain('{ path: "title", weight: "A" }');
        expect(read.block).toContain('{ path: "body", weight: "C" }');

        // A block that does not reproduce the stamp is not written at all.
        comments.set("search_vector", "rebase:search:v1:0000000000000000");
        const tampered = reconstructSearchBlock({ schema: "public", table: "posts", columns, comments, keyByColumn });
        expect(tampered.block).toBeUndefined();
        expect(tampered.note).toMatch(/does not reproduce the column's stamp/);
    });
});
