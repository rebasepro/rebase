/**
 * A field operation's result answers to the property's declared bounds, and the
 * check is part of the UPDATE that does the arithmetic.
 *
 * `{ stock: -5 }` on `stock: { type: "number", validation: { min: 0 } }` is a
 * 400, and `{ stock: { $inc: -1000 } }` stored `-995`. The request cannot judge
 * the operation — what it produces depends on the stored row, which the request
 * never sees — and reading the row first to judge it would reopen the race the
 * operation exists to close: two decrements of a stock of 1 each read `1`, each
 * find room for one more, and both go through. So the bound is a condition on
 * the UPDATE itself (`WHERE … AND COALESCE(stock, 0) + $n >= 0`), evaluated
 * against the row the statement holds locked. Under READ COMMITTED, a second
 * UPDATE blocked on the first re-evaluates its WHERE against the row the first
 * one committed, so it sees `0 - 1` and matches nothing.
 *
 * PGlite is one connection, so the two decrements below are interleaved at
 * every await rather than blocked on each other's row lock. What they prove is
 * that the decision is made from the stored row inside the statement and not
 * from anything read before it; the statement-shape test pins that the guard is
 * in the UPDATE's WHERE, which is what makes the lock-wait case safe on a real
 * server.
 *
 * A real driver over PGlite, writing the way every request door writes.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { doublePrecision, integer, jsonb, pgTable, serial, text, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const productsTable = pgTable("products", {
    id: serial("id").primaryKey(),
    name: varchar("name"),
    stock: integer("stock"),
    rating: doublePrecision("rating"),
    tags: text("tags").array(),
    labels: jsonb("labels")
});

const products = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        stock: { name: "Stock", type: "number", validation: { min: 0, max: 100 } },
        rating: { name: "Rating", type: "number", validation: { moreThan: 0, lessThan: 5 } },
        // A native `text[]` and a jsonb document, because the two compile to
        // different statements and each needs its own way to count elements.
        tags: { name: "Tags", type: "array", of: { name: "Tag", type: "string" }, validation: { min: 1, max: 3 } },
        labels: {
            name: "Labels",
            type: "array",
            columnName: "labels",
            of: { name: "Label", type: "string" },
            validation: { min: 1, max: 3 }
        }
    }
} as CollectionConfig;

let db: PGlite;
let driver: PostgresBackendDriver;
let statements: string[];

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(
        "CREATE TABLE products (id serial PRIMARY KEY, name varchar, stock integer, rating double precision, " +
        "tags text[], labels jsonb);"
    );
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([products]);
    registry.registerTable(productsTable, "products");
    statements = [];
    const orm = drizzle(db, {
        schema: { products: productsTable },
        logger: { logQuery: (query: string) => { statements.push(query); } }
    }) as never;
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
});

afterEach(async () => {
    await db.close();
});

type Row = { id: number; name: string | null; stock: number | null; rating: number | null; tags: string[] | null; labels: string[] | null };

async function seed(values: Partial<Omit<Row, "id">>): Promise<number> {
    const result = await db.query<{ id: number }>(
        "INSERT INTO products (name, stock, rating, tags, labels) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [values.name ?? "widget", values.stock ?? null, values.rating ?? null, values.tags ?? null,
            values.labels === undefined || values.labels === null ? null : JSON.stringify(values.labels)]
    );
    return result.rows[0].id;
}

async function stored(id: number): Promise<Row> {
    const result = await db.query<Row>("SELECT * FROM products WHERE id = $1", [id]);
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
}

const update = (id: number | string, values: Record<string, unknown>) =>
    driver.save({ path: "products", id: String(id), values, collection: products, status: "existing" });

/** The refusal a plain value breaking the same rule gets: a 400 naming the field and the rule. */
const refusedBy = (field: string, code: string) => expect.objectContaining({
    statusCode: 400,
    code: "VALIDATION_CONSTRAINT",
    details: expect.objectContaining({
        collection: "products",
        violations: [expect.objectContaining({ field, code })]
    })
});

describe("$inc against a number's bounds", () => {
    it("takes the value to exactly the floor", async () => {
        const id = await seed({ stock: 5 });

        await update(id, { stock: { $inc: -5 } });

        expect((await stored(id)).stock).toBe(0);
    });

    it("refuses one past the floor with the 400 a plain value gets, and writes nothing", async () => {
        const id = await seed({ stock: 5, name: "before" });

        const attempt = update(id, { stock: { $inc: -6 }, name: "after" });

        await expect(attempt).rejects.toEqual(refusedBy("stock", "min"));
        await expect(attempt).rejects.toThrow(/'stock' must be at least 0/);
        // The whole statement is refused, the plain value beside the operation
        // included — it is one write.
        expect(await stored(id)).toMatchObject({ stock: 5, name: "before" });
    });

    it("refuses one past the ceiling", async () => {
        const id = await seed({ stock: 95 });

        await expect(update(id, { stock: { $inc: 6 } })).rejects.toEqual(refusedBy("stock", "max"));
        await expect(update(id, { stock: { $inc: 6 } })).rejects.toThrow(/'stock' must be at most 100/);
        expect((await stored(id)).stock).toBe(95);

        await update(id, { stock: { $inc: 5 } });
        expect((await stored(id)).stock).toBe(100);
    });

    it("counts an unset value as 0, as the increment itself does", async () => {
        const id = await seed({ stock: null });

        await expect(update(id, { stock: { $inc: -1 } })).rejects.toEqual(refusedBy("stock", "min"));
        expect((await stored(id)).stock).toBeNull();

        await update(id, { stock: { $inc: 3 } });
        expect((await stored(id)).stock).toBe(3);
    });

    it("holds the exclusive bounds, on a floating-point column", async () => {
        const id = await seed({ rating: 1 });

        await expect(update(id, { rating: { $inc: -1 } })).rejects.toEqual(refusedBy("rating", "more_than"));
        await expect(update(id, { rating: { $inc: 4 } })).rejects.toEqual(refusedBy("rating", "less_than"));
        await update(id, { rating: { $inc: 3.5 } });
        expect((await stored(id)).rating).toBe(4.5);
    });

    it("lets exactly one of two decrements through when only one fits", async () => {
        const id = await seed({ stock: 1 });

        const outcomes = await Promise.allSettled([
            update(id, { stock: { $inc: -1 } }),
            update(id, { stock: { $inc: -1 } })
        ]);

        expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
        const refused = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
        expect(refused).toHaveLength(1);
        expect(refused[0].reason).toEqual(refusedBy("stock", "min"));
        expect((await stored(id)).stock).toBe(0);
    });

    it("decides in the UPDATE that does the arithmetic, not from a read before it", async () => {
        const id = await seed({ stock: 5 });

        await update(id, { stock: { $inc: -1 } });

        const updates = statements.filter(statement => /^update "products"/i.test(statement));
        expect(updates).toHaveLength(1);
        const where = updates[0].slice(updates[0].toLowerCase().indexOf(" where "));
        expect(where).toMatch(/COALESCE\("products"\."stock", 0\) \+ \$\d+\) >= \$\d+::numeric/);
        expect(where).toMatch(/COALESCE\("products"\."stock", 0\) \+ \$\d+\) <= \$\d+::numeric/);
    });

    it("is still a 404 for a row that is not there", async () => {
        await expect(update(999, { stock: { $inc: -1 } })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe.each([
    ["a native array", "tags"],
    ["a jsonb array", "labels"]
] as const)("$push and $pull against %s's item bounds", (_kind, field) => {
    it("pushes onto a non-empty array up to the maximum, and refuses one past it", async () => {
        const id = await seed({ [field]: ["a", "b"] });

        // Two elements on their own are within `max: 3`; with the two stored,
        // they are not.
        await expect(update(id, { [field]: { $push: ["c", "d"] } })).rejects.toEqual(refusedBy(field, "max_items"));
        await expect(update(id, { [field]: { $push: ["c", "d"] } })).rejects.toThrow(new RegExp(`'${field}' must have at most 3 items`));
        expect((await stored(id))[field]).toEqual(["a", "b"]);

        await update(id, { [field]: { $push: "c" } });
        expect((await stored(id))[field]).toEqual(["a", "b", "c"]);
    });

    it("pulls down to the minimum, and refuses one below it", async () => {
        const id = await seed({ [field]: ["a", "b"] });

        await update(id, { [field]: { $pull: "a" } });
        expect((await stored(id))[field]).toEqual(["b"]);

        await expect(update(id, { [field]: { $pull: "b" } })).rejects.toEqual(refusedBy(field, "min_items"));
        await expect(update(id, { [field]: { $pull: "b" } })).rejects.toThrow(new RegExp(`'${field}' must have at least 1 item`));
        expect((await stored(id))[field]).toEqual(["b"]);
    });

    it("counts an unset array as empty for a push", async () => {
        const id = await seed({ [field]: null });

        await update(id, { [field]: { $push: "a" } });
        expect((await stored(id))[field]).toEqual(["a"]);
    });
});

describe("an unset array", () => {
    it("is left unset by a $pull on a native column, which no minimum can judge", async () => {
        // `array_remove(NULL, …)` is NULL, and a range has nothing to say about
        // a value that is not there — the rule a plain `null` gets.
        const id = await seed({ tags: null });

        await update(id, { tags: { $pull: "a" } });

        expect((await stored(id)).tags).toBeNull();
    });
});
