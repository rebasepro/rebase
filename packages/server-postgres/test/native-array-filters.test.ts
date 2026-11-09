/**
 * The array operators on a native array column whose elements are not text.
 *
 * `ARRAY[$1, $2]` around untyped parameters is a `text[]`, so `integer[] @>
 * ARRAY[$1, $2]` has no operator — "operator does not exist: integer[] @>
 * text[]" — and every array filter on an `integer[]`, `uuid[]`, `boolean[]` or
 * enum array was a 500. The list is bound as one untyped array literal, which
 * Postgres types as the column's own array type, whatever the column is: an
 * enum array is introspected at runtime as `text[]`, so a cast to the drizzle
 * column's type would still have missed it.
 *
 * Over PGlite: the question is what Postgres makes of the statement.
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { boolean, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { WhereFilterOp } from "@rebasepro/types";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";

const things = pgTable("things", {
    id: integer("id").primaryKey(),
    nums: integer("nums").array(),
    flags: boolean("flags").array(),
    refs: uuid("refs").array(),
    // `mood[]` in the database; the runtime catalogue reads an enum as text.
    moods: text("moods").array(),
    tags: text("tags").array()
});

const U1 = "00000000-0000-0000-0000-000000000001";
const U2 = "00000000-0000-0000-0000-000000000002";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client);
    await client.exec(`
        CREATE TYPE mood AS ENUM ('calm', 'loud', 'sad');
        CREATE TABLE things (id int PRIMARY KEY, nums int[], flags boolean[], refs uuid[], moods mood[], tags text[]);
        INSERT INTO things VALUES
            (1, '{1,2,3}', '{true}',       '{${U1}}',       '{calm,loud}', '{"a,b","q\\"uote"}'),
            (2, '{4}',     '{false}',      '{${U2}}',       '{sad}',       '{plain}'),
            (3, '{}',      '{true,false}', '{${U1},${U2}}', '{}',          '{}');
    `);
});

afterAll(async () => {
    await client.close();
});

type Column = typeof things.nums | typeof things.flags | typeof things.refs | typeof things.moods | typeof things.tags;

async function ids(column: Column, op: WhereFilterOp, value: unknown): Promise<number[]> {
    const condition = DrizzleConditionBuilder.buildSingleFilterCondition(column, op, value);
    if (!condition) throw new Error(`no condition for ${op}`);
    const rows = await db.select({ id: things.id }).from(things).where(condition).orderBy(things.id);
    return rows.map(row => row.id);
}

describe("array operators on non-text native arrays", () => {
    it("integer[]: contains-all, contained-by, contains-any and contains", async () => {
        expect(await ids(things.nums, "array-contains-all", [1, 2])).toEqual([1]);
        expect(await ids(things.nums, "array-contained-by", [1, 2, 3, 4])).toEqual([1, 2, 3]);
        expect(await ids(things.nums, "array-contained-by", [4])).toEqual([2, 3]);
        expect(await ids(things.nums, "array-contains-any", [3, 4])).toEqual([1, 2]);
        expect(await ids(things.nums, "array-contains-any", 4)).toEqual([2]);
        expect(await ids(things.nums, "array-contains", 2)).toEqual([1]);
    });

    it("takes numbers the wire sent as strings", async () => {
        expect(await ids(things.nums, "array-contains-all", ["1", "3"])).toEqual([1]);
    });

    it("boolean[] and uuid[]", async () => {
        expect(await ids(things.flags, "array-contains-all", [true, false])).toEqual([3]);
        expect(await ids(things.refs, "array-contains-any", [U2])).toEqual([2, 3]);
        expect(await ids(things.refs, "array-contained-by", [U1])).toEqual([1]);
    });

    it("an enum array the catalogue reads as text[]", async () => {
        expect(await ids(things.moods, "array-contains-all", ["calm"])).toEqual([1]);
        expect(await ids(things.moods, "array-contains", "sad")).toEqual([2]);
        expect(await ids(things.moods, "array-contains-any", ["sad", "loud"])).toEqual([1, 2]);
    });

    it("text[] elements holding a comma, a quote or a backslash are one element each", async () => {
        expect(await ids(things.tags, "array-contains-all", ["a,b", "q\"uote"])).toEqual([1]);
        expect(await ids(things.tags, "array-contains", "a")).toEqual([]);
        expect(await ids(things.tags, "array-contained-by", ["plain", "back\\slash"])).toEqual([2, 3]);
    });
});
