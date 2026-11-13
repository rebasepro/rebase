import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import { col, defineTable, json, type DataDriver } from "@rebasepro/types";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-b-fakes";
import { compileTables } from "./helpers/tables";

/**
 * The column rules the legacy collection shape could not carry — and the
 * lowering refused until the write validation read the table's descriptor —
 * enforced on every REST write door: create, update, upsert (`?on_conflict=`
 * and `/bulk` with `upsert: true`), `/bulk` and `/_batch`.
 *
 * - `text-one-of`: `.oneOf([...])` on a text column;
 * - `array-unique-items`: `validate({ uniqueItems: true })` on an array;
 * - array item rules (`col.array(col.text().validate(...).oneOf(...))`);
 * - `json-document-shape`: a document whose top is a scalar or a `json.oneOf()`;
 * - `json-one-of-placement`: `json.oneOf()` as a field of an object;
 * - `json-unknown-field`: `json.unknown()` as a field or a variant — anything goes;
 * - `array-unique-by`: `validate({ uniqueBy: [...] })` on a JSON array of objects;
 * - `strictWrites: false`: a key the table does not declare reaches the driver.
 */
const items = defineTable("items", {
    columns: {
        id: col.text().primaryKey(),
        code: col.text().unique(),
        status: col.text({ enum: ["draft", "live"] }),
        tags: col.text({ enum: ["a", "b", "c"] }).validate({ max: 3 }).array().validate({ uniqueItems: true, maxItems: 3 }),
        headline: col.jsonb(json.string().validate({ max: 5 })),
        block: col.jsonb(json.oneOf({ text: json.string().validate({ min: 2 }), count: json.number().validate({ integer: true }) })),
        doc: col.jsonb(json.object({
            body: json.oneOf({ quote: json.string().required() }),
            extra: json.unknown(),
            title: json.string().required()
        })),
        list: col.jsonb(json.array(json.oneOf({ note: json.string(), any: json.unknown() }))),
        lines: col.jsonb(json.array(json.object({ sku: json.string(), qty: json.number() })).validate({ uniqueBy: ["sku"] }))
    },
    rls: "admin-only"
});

/** A table that accepts keys it does not declare (`strictWrites: false`), and one that does not. */
const loose = defineTable("loose", {
    columns: { id: col.text().primaryKey(), name: col.text() },
    strictWrites: false,
    rls: "admin-only"
});
const strict = defineTable("strict", {
    columns: { id: col.text().primaryKey(), name: col.text() },
    rls: "admin-only"
});

const fixture = compileTables([items, loose, strict]);

type Violations = { error: { code: string; details?: { violations?: { field: string; code: string }[] } } };

describe("column rules the descriptor carries, on every write door", () => {
    let save: jest.Mock<DataDriver["save"]>;
    let saveMany: jest.Mock<NonNullable<DataDriver["saveMany"]>>;
    let batchWrite: jest.Mock<NonNullable<DataDriver["batchWrite"]>>;
    let driver: DataDriver;

    beforeEach(() => {
        save = jest.fn<DataDriver["save"]>(async () => ({ id: "1" }));
        saveMany = jest.fn<NonNullable<DataDriver["saveMany"]>>(async () => [{ id: "1" }]);
        batchWrite = jest.fn<NonNullable<DataDriver["batchWrite"]>>(async () => [{ id: "1" }]);
        driver = fakeDataDriver({ save, saveMany, batchWrite, fetchOne: async () => ({ id: "1" }) });
    });

    const request = (method: string, path: string, body: unknown) => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", driver);
            await next();
        });
        app.route("/", new RestApiGenerator(fixture, driver).generateRoutes());
        return app.fetch(new Request(`http://localhost${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        }));
    };

    /** The write through each door, answered: the violations it was refused with. */
    const doors = (values: Record<string, unknown>) => ({
        create: () => request("POST", "/items", { id: "1", ...values }),
        update: () => request("PATCH", "/items/1", values),
        upsert: () => request("POST", "/items?on_conflict=code", { id: "1", code: "x", ...values }),
        bulk: () => request("POST", "/items/bulk", { rows: [{ id: "1", ...values }], upsert: true }),
        batch: () => request("POST", "/_batch", { operations: [{ op: "update", table: "items", id: "1", values }] })
    });

    const refusedEverywhere = async (values: Record<string, unknown>, expected: { field: string; code: string }) => {
        for (const [door, send] of Object.entries(doors(values))) {
            const res = await send();
            const body = await res.json() as Violations;
            expect({ door, status: res.status, code: body.error?.code }).toEqual({ door, status: 400, code: "VALIDATION_CONSTRAINT" });
            expect(body.error.details?.violations).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
        }
        expect(save).not.toHaveBeenCalled();
        expect(saveMany).not.toHaveBeenCalled();
        expect(batchWrite).not.toHaveBeenCalled();
    };

    it("refuses a value outside a text column's `.oneOf()` [text-one-of]", async () => {
        await refusedEverywhere({ status: "gone" }, { field: "status", code: "enum" });
    });

    it("refuses an array holding the same item twice [array-unique-items]", async () => {
        await refusedEverywhere({ tags: ["a", "a"] }, { field: "tags", code: "unique_items" });
    });

    it("refuses two object items with the same value in a `uniqueBy` field [array-unique-by]", async () => {
        await refusedEverywhere(
            { lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: 1 }, { sku: "A", qty: 2 }] },
            { field: "lines", code: "unique_by" }
        );
        const res = await request("POST", "/items", { id: "1", lines: [{ sku: "A", qty: 1 }, { sku: "A", qty: 2 }] });
        const body = await res.json() as { error: { details: { violations: { message: string }[] } } };
        expect(body.error.details.violations[0].message).toBe("'lines' must not hold two items with the same 'sku' (items 0 and 1 have the same 'sku').");
    });

    it("accepts object items that differ in every `uniqueBy` field, and items without one", async () => {
        const values = { lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: 1 }, { qty: 3 }, { qty: 4 }] };
        for (const [door, send] of Object.entries(doors(values))) {
            const res = await send();
            expect({ door, status: res.status }).toEqual({ door, status: door === "create" || door === "upsert" ? 201 : 200 });
        }
    });

    it("refuses pushing two items with the same `uniqueBy` field [array-unique-by]", async () => {
        const res = await request("PATCH", "/items/1", { lines: { $push: [{ sku: "C", qty: 1 }, { sku: "C", qty: 9 }] } });
        expect(res.status).toBe(400);
        expect(((await res.json()) as Violations).error.details?.violations)
            .toEqual(expect.arrayContaining([expect.objectContaining({ field: "lines", code: "unique_by" })]));
        const one = await request("PATCH", "/items/1", { lines: { $push: { sku: "C", qty: 1 } } });
        expect(one.status).toBe(200);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it("hands a key a `strictWrites: false` table does not declare to the driver, on create and update", async () => {
        const created = await request("POST", "/loose", { id: "1", name: "n", nickname: "x" });
        expect(created.status).toBe(201);
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ values: expect.objectContaining({ nickname: "x" }) }));
        const updated = await request("PATCH", "/loose/1", { nickname: "y" });
        expect(updated.status).toBe(200);
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ values: expect.objectContaining({ nickname: "y" }) }));
    });

    it("refuses a key the table does not declare by default, naming the table and the column", async () => {
        for (const send of [
            () => request("POST", "/strict", { id: "1", name: "n", nickname: "x" }),
            () => request("PATCH", "/strict/1", { nickname: "y" })
        ]) {
            const res = await send();
            const body = await res.json() as { error: { code: string; message: string } };
            expect(res.status).toBe(400);
            expect(body.error.code).toBe("VALIDATION_UNKNOWN_FIELDS");
            expect(body.error.message).toContain("Table 'strict' has no column 'nickname'. Known columns: 'id', 'name'.");
        }
        expect(save).not.toHaveBeenCalled();
    });

    it("refuses an item outside the item's `.oneOf()`, and one over the item's length", async () => {
        await refusedEverywhere({ tags: ["zz"] }, { field: "tags[0]", code: "enum" });
    });

    it("judges a document whose top is a scalar by its shape [json-document-shape]", async () => {
        await refusedEverywhere({ headline: "far too long" }, { field: "headline", code: "max_length" });
    });

    it("judges a document whose top is a typed block, its value by its variant [json-document-shape]", async () => {
        await refusedEverywhere({ block: { type: "text", value: "x" } }, { field: "block.value", code: "min_length" });
        await refusedEverywhere({ block: { type: "count", value: 1.5 } }, { field: "block.value", code: "integer" });
    });

    it("judges a typed block that is a field of an object, and a required field [json-one-of-placement]", async () => {
        await refusedEverywhere({ doc: { title: "t", body: { type: "quote", value: "" } } }, { field: "doc.body.value", code: "required" });
        await refusedEverywhere({ doc: { body: { type: "quote", value: "q" } } }, { field: "doc.title", code: "required" });
    });

    it("accepts anything under `json.unknown()`, as a field or as a variant [json-unknown-field]", async () => {
        const values = {
            doc: { title: "t", body: { type: "quote", value: "q" }, extra: { any: ["thing", 1] } },
            list: [{ type: "any", value: { whatever: true } }, { type: "note", value: "n" }],
            status: "live",
            tags: ["a", "b"],
            headline: "short",
            block: { type: "count", value: 2 }
        };
        for (const [door, send] of Object.entries(doors(values))) {
            const res = await send();
            expect({ door, status: res.status }).toEqual({ door, status: door === "create" || door === "upsert" ? 201 : 200 });
        }
    });

    it("checks pushed items as items, and refuses pushing the same item twice", async () => {
        const res = await request("PATCH", "/items/1", { tags: { $push: ["c", "c"] } });
        const body = await res.json() as Violations;
        expect(res.status).toBe(400);
        expect(body.error.details?.violations).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "tags", code: "unique_items" })
        ]));
        const bad = await request("PATCH", "/items/1", { tags: { $push: "zz" } });
        expect(((await bad.json()) as Violations).error.details?.violations)
            .toEqual(expect.arrayContaining([expect.objectContaining({ field: "tags", code: "enum" })]));
    });
});
