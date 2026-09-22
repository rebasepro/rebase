import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { hasFieldOps, parseFieldOp, splitFieldOps } from "../src/api/rest/field-ops";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * `{ views: { $inc: 1 } }` — a change to the stored value, not a value.
 *
 * The difference is the read a caller no longer has to make, and the race that
 * read opens: two requests that each read `4`, add one and write `5` end at
 * `5`, and nothing in either response says an increment went missing. It is the
 * ordinary shape of a view counter, a stock level, a tag list two people edit.
 *
 * What this file pins is the *contract* — which operators exist, what they
 * accept, which property types they are legal on, and that the marker reaches
 * the driver intact. The SQL they compile to is the driver's, and is pinned in
 * `packages/server-postgres/test/field-op-sql.test.ts`.
 */

const posts = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        views: { name: "Views", type: "number" },
        tags: { name: "Tags", type: "array", of: { name: "Tag", type: "string" } },
        meta: { name: "Meta", type: "map", properties: {} }
    }
} as unknown as CollectionConfig;

function createHarness() {
    const saves: Record<string, unknown>[] = [];
    const driver = {
        key: "postgres",
        initialised: true,
        async fetchOne({ id }: { id: string }) {
            return { id: String(id), title: "x", views: 1 };
        },
        async save(props: Record<string, unknown>) {
            saves.push(props);
            return { id: "p1", ...(props.values as Record<string, unknown>) };
        },
        async saveMany({ rows }: { rows: Record<string, unknown>[] }) {
            rows.forEach((values) => saves.push({ values }));
            return rows;
        }
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1" });
        await next();
    });
    app.route("/", new RestApiGenerator([posts], driver).generateRoutes());
    return { app, saves };
}

const patch = (app: Hono, body: unknown) =>
    app.request("/posts/p1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

const post = (app: Hono, body: unknown) =>
    app.request("/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

const errorOf = async (res: Response) =>
    (await res.json() as { error: { code: string; message: string } }).error;

describe("field operations on PATCH", () => {
    it("passes a legal operation through to the driver unchanged", async () => {
        // Unchanged on purpose: the driver splits and compiles them, so every
        // request boundary — HTTP, socket, in-process — gets one implementation
        // rather than a rule applied at whichever door remembered.
        const { app, saves } = createHarness();

        const res = await patch(app, { views: { $inc: 1 } });

        expect(res.status).toBe(200);
        expect(saves[0].values).toEqual({ views: { $inc: 1 } });
    });

    it("carries plain values and operations in one body", async () => {
        const { app, saves } = createHarness();

        await patch(app, { title: "New", views: { $inc: 1 } });

        expect(saves[0].values).toEqual({ title: "New", views: { $inc: 1 } });
    });

    it.each([
        ["$inc", "views", 2],
        ["$push", "tags", "new"],
        ["$pull", "tags", "old"],
        ["$merge", "meta", { seen: true }]
    ])("accepts %s on the property type it is defined on", async (operator, field, operand) => {
        const { app } = createHarness();

        const res = await patch(app, { [field]: { [operator]: operand } });

        expect(res.status).toBe(200);
    });

    it.each([
        ["$inc on an array", { tags: { $inc: 1 } }],
        ["$push on a number", { views: { $push: 1 } }],
        ["$pull on a map", { meta: { $pull: "x" } }],
        ["$merge on a string", { title: { $merge: {} } }]
    ])("refuses %s", async (_name, body) => {
        const { app, saves } = createHarness();

        const res = await patch(app, body);

        expect(res.status).toBe(400);
        expect((await errorOf(res)).code).toBe("INVALID_FIELD_OPERATION");
        expect(saves).toHaveLength(0);
    });

    it("refuses a misspelled operator rather than storing it as a document", async () => {
        // The failure this exists to prevent: `{ $increment: 1 }` silently
        // written to a number column as jsonb. Any `$`-prefixed key is an
        // attempted operation, so a typo is an error and not a value.
        const { app, saves } = createHarness();

        const res = await patch(app, { views: { $increment: 1 } });

        expect(res.status).toBe(400);
        expect((await errorOf(res)).message).toMatch(/unknown field operator '\$increment'/);
        expect(saves).toHaveLength(0);
    });

    it("refuses two operators on one field", async () => {
        const { app } = createHarness();

        const res = await patch(app, { tags: { $push: "a", $pull: "b" } });

        expect(res.status).toBe(400);
        expect((await errorOf(res)).message).toMatch(/exactly one operator/);
    });

    it("refuses an operand of the wrong shape", async () => {
        const { app } = createHarness();

        expect((await patch(app, { views: { $inc: "one" } })).status).toBe(400);
        expect((await patch(app, { meta: { $merge: "not an object" } })).status).toBe(400);
        // An empty list changes nothing, which is more likely a bug in the
        // caller's loop than an instruction.
        expect((await patch(app, { tags: { $push: [] } })).status).toBe(400);
    });

    it("refuses an operation on a field the collection does not declare", async () => {
        const { app } = createHarness();

        const res = await patch(app, { nonsense: { $inc: 1 } });

        expect(res.status).toBe(400);
    });

    it("refuses an operation on a create", async () => {
        // `views + 1` over a row that does not exist is just `1`, so accepting
        // it would make `$inc` mean two things depending on an unobservable race.
        const { app, saves } = createHarness();

        const res = await post(app, { title: "x", views: { $inc: 1 } });

        expect(res.status).toBe(400);
        expect((await errorOf(res)).code).toBe("INVALID_FIELD_OPERATION");
        expect(saves).toHaveLength(0);
    });

    it("refuses an operation in a bulk create", async () => {
        const { app } = createHarness();

        const res = await app.request("/posts/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: [{ title: "a" }, { views: { $inc: 1 } }] })
        });

        expect(res.status).toBe(400);
        expect((await errorOf(res)).message).toMatch(/Row 1/);
    });
});

describe("field operations against the property's declared rules", () => {
    /**
     * `{ tags: { $push: "bogus" } }` stores `"bogus"` in `tags` exactly as
     * `{ tags: [..., "bogus"] }` does, and `{ stock: { $inc: -1000 } }` moves
     * `stock` exactly as a new value would — but only the plain values were
     * checked. An operation went around every `enum`, `max` and `min` the
     * collection declares, while the same change sent as a value was a 400.
     */
    const products = {
        slug: "products",
        name: "Products",
        singularName: "Product",
        table: "products",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            stock: { name: "Stock", type: "number", validation: { min: 0 } },
            rating: { name: "Rating", type: "number", enum: { 1: "One", 2: "Two" } },
            views: { name: "Views", type: "number", validation: { integer: true } },
            price: { name: "Price", type: "number" },
            tags: {
                name: "Tags",
                type: "array",
                of: { name: "Tag", type: "string", enum: { sale: "Sale", new: "New" } },
                validation: { max: 2 }
            },
            meta: {
                name: "Meta",
                type: "map",
                properties: { color: { name: "Color", type: "string", enum: { red: "Red", blue: "Blue" } } }
            }
        }
    } as unknown as CollectionConfig;

    function productHarness() {
        const saves: Record<string, unknown>[] = [];
        const driver = {
            key: "postgres",
            initialised: true,
            async fetchOne({ id }: { id: string }) {
                return { id: String(id), stock: 5, views: 1, tags: ["sale"] };
            },
            async save(props: Record<string, unknown>) {
                saves.push(props);
                return { id: "p1", ...(props.values as Record<string, unknown>) };
            },
            async updateMany({ updates }: { updates: { id: string; values: Record<string, unknown> }[] }) {
                updates.forEach((update) => saves.push(update));
                return updates.map((update) => ({ id: update.id, ...update.values }));
            }
        } as unknown as DataDriver;

        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", driver);
            c.set("user", { uid: "user-1" });
            await next();
        });
        app.route("/", new RestApiGenerator([products], driver).generateRoutes());
        return { app, saves };
    }

    const patchProduct = (app: Hono, body: unknown) =>
        app.request("/products/p1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

    const refusal = async (res: Response) => {
        expect(res.status).toBe(400);
        return (await res.json() as {
            error: { code: string; message: string; details?: { violations?: { field: string; code: string }[] } }
        }).error;
    };

    it("refuses a pushed element the element's enum does not define", async () => {
        const { app, saves } = productHarness();

        const error = await refusal(await patchProduct(app, { tags: { $push: "bogus" } }));

        expect(error.code).toBe("VALIDATION_CONSTRAINT");
        expect(error.message).toContain("'bogus'");
        expect(error.details?.violations).toEqual([expect.objectContaining({ field: "tags", code: "enum" })]);
        expect(saves).toHaveLength(0);
    });

    it("judges every element of a pushed list", async () => {
        const { app } = productHarness();

        const error = await refusal(await patchProduct(app, { tags: { $push: ["new", "bogus"] } }));

        expect(error.code).toBe("VALIDATION_CONSTRAINT");
        expect(error.message).toContain("'bogus'");
    });

    it("refuses pushing more elements than the array may hold at all", async () => {
        const { app } = productHarness();

        const error = await refusal(await patchProduct(app, { tags: { $push: ["sale", "new", "sale"] } }));

        expect(error.details?.violations).toEqual([expect.objectContaining({ field: "tags", code: "max_items" })]);
    });

    it("refuses a merged key the map's own property rejects", async () => {
        const { app } = productHarness();

        const error = await refusal(await patchProduct(app, { meta: { $merge: { color: "green" } } }));

        expect(error.code).toBe("VALIDATION_CONSTRAINT");
        expect(error.details?.violations).toEqual([expect.objectContaining({ field: "meta.color", code: "enum" })]);
    });

    it("refuses a fractional increment of a whole-number property", async () => {
        const { app } = productHarness();

        const error = await refusal(await patchProduct(app, { views: { $inc: 1.5 } }));

        expect(error.details?.violations).toEqual([expect.objectContaining({ field: "views", code: "integer" })]);
    });

    it("refuses the same through the bulk update route", async () => {
        const { app, saves } = productHarness();

        const res = await app.request("/products/bulk", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: [{ id: "p1", data: { tags: { $push: "bogus" } } }] })
        });

        expect((await refusal(res)).message).toMatch(/^Row 0: .*'bogus'/);
        expect(saves).toHaveLength(0);
    });

    it("passes an operation within the rules through unchanged", async () => {
        const { app, saves } = productHarness();

        const res = await patchProduct(app, {
            tags: { $push: "new" },
            views: { $inc: 2 },
            price: { $inc: -1.5 },
            meta: { $merge: { color: "red" } }
        });

        expect(res.status).toBe(200);
        expect(saves[0].values).toEqual({
            tags: { $push: "new" },
            views: { $inc: 2 },
            price: { $inc: -1.5 },
            meta: { $merge: { color: "red" } }
        });
    });
});

describe("the parser", () => {
    it("splits operations out of the plain values", () => {
        const { values, fieldOps } = splitFieldOps({ title: "x", views: { $inc: 2 } });

        expect(values).toEqual({ title: "x" });
        expect(fieldOps).toEqual({ views: { operator: "$inc", operand: 2 } });
    });

    it("leaves an ordinary object alone", () => {
        expect(parseFieldOp("meta", { seen: true })).toBeUndefined();
        expect(hasFieldOps({ meta: { seen: true } })).toBe(false);
    });

    it("does not read a batch `$ref` as a misspelled operator", () => {
        // The two markers share the `$` namespace. Reading one as the other
        // refused every `$ref` in a batch with "unknown field operator '$ref'".
        expect(parseFieldOp("order_id", { $ref: "order.id" })).toBeUndefined();
        expect(hasFieldOps({ order_id: { $ref: "order.id" } })).toBe(false);
    });

    it("leaves a Date alone", () => {
        expect(parseFieldOp("when", new Date())).toBeUndefined();
    });
});
