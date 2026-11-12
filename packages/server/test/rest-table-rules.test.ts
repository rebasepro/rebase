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
 * - `json-unknown-field`: `json.unknown()` as a field or a variant — anything goes.
 */
const items = defineTable("items", {
    columns: {
        id: col.text().primaryKey(),
        code: col.text().unique(),
        status: col.text().oneOf(["draft", "live"]),
        tags: col.array(col.text().oneOf(["a", "b", "c"]).validate({ max: 3 })).validate({ uniqueItems: true, maxItems: 3 }),
        headline: col.jsonb(json.string().validate({ max: 5 })),
        block: col.jsonb(json.oneOf({ text: json.string().validate({ min: 2 }), count: json.number().validate({ integer: true }) })),
        doc: col.jsonb(json.object({
            body: json.oneOf({ quote: json.string().required() }),
            extra: json.unknown(),
            title: json.string().required()
        })),
        list: col.jsonb(json.array(json.oneOf({ note: json.string(), any: json.unknown() })))
    },
    rls: "admin-only"
});

const fixture = compileTables([items]);

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
