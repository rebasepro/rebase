import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { resolveBatchRefs } from "../src/api/rest/batch";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * `POST /api/data/_batch` — writes across collections, or none of them.
 *
 * `/bulk` is one collection at a time, which is the wrong shape for the writes
 * that most need to be atomic: an order and its line items, a user and their
 * membership row. Sent as separate requests those half-succeed, and the
 * recovery — read back, work out which half landed, undo it — is code nobody
 * writes.
 *
 * The driver here does not open a transaction; it cannot, being a fake. What is
 * pinned instead is everything the *route* decides: that a body which cannot
 * work is refused before the driver is called at all (which is what makes
 * all-or-nothing cheap), that operations reach the driver in order and shape,
 * that a key is honoured, and that `$ref` resolves backwards and only backwards.
 */

const orders = {
    slug: "orders",
    name: "Orders",
    singularName: "Order",
    table: "orders",
    properties: {
        id: { name: "ID", type: "number", isId: "serial" },
        total: { name: "Total", type: "number" },
        email: { name: "Email", type: "string", validation: { unique: true } }
    }
} as unknown as CollectionConfig;

const items = {
    slug: "order_items",
    name: "Order items",
    singularName: "Order item",
    table: "order_items",
    properties: {
        id: { name: "ID", type: "number", isId: "serial" },
        order_id: { name: "Order", type: "number" },
        sku: { name: "SKU", type: "string" },
        tags: { name: "Tags", type: "array", of: { name: "Tag", type: "string" } }
    }
} as unknown as CollectionConfig;

interface Harness {
    app: Hono;
    calls: Record<string, unknown>[][];
    /** Set to make the driver reject, as a real transaction would. */
    fail?: (index: number) => Error | undefined;
}

function createHarness(options?: {
    noBatchWrite?: boolean;
    failAt?: number;
}): Harness {
    const calls: Record<string, unknown>[][] = [];
    let nextId = 100;

    const driver = {
        key: "postgres",
        initialised: true,
        ...(options?.noBatchWrite
            ? {}
            : {
                async batchWrite({ operations }: { operations: Record<string, unknown>[] }) {
                    calls.push(operations);
                    const named = new Map<string, Record<string, unknown>>();
                    const rows: (Record<string, unknown> | null)[] = [];
                    operations.forEach((operation, index) => {
                        if (options?.failAt === index) {
                            throw Object.assign(new Error("row rejected"), { statusCode: 400 });
                        }
                        if (operation.op === "delete") { rows.push(null); return; }
                        const values = resolveBatchRefs(operation.values, named) as Record<string, unknown>;
                        const row = { id: operation.id ?? nextId++, ...values };
                        if (operation.ref) named.set(operation.ref as string, row);
                        rows.push(row);
                    });
                    return rows;
                }
            })
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1" });
        await next();
    });
    app.route("/", new RestApiGenerator([orders, items], driver).generateRoutes());
    return { app, calls };
}

const batch = (app: Hono, body: unknown, headers?: Record<string, string>) =>
    app.request("/_batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify(body)
    });

describe("POST /_batch", () => {
    it("writes across two collections in one call, in order", async () => {
        const { app, calls } = createHarness();

        const res = await batch(app, {
            operations: [
                { op: "create", collection: "orders", values: { total: 40 }, ref: "order" },
                { op: "create", collection: "order_items", values: { order_id: 1, sku: "A-1" } }
            ]
        });

        expect(res.status).toBe(200);
        const body = await res.json() as { data: unknown[]; meta: { operations: number } };
        expect(body.data).toHaveLength(2);
        expect(body.meta.operations).toBe(2);
        expect(calls[0].map(o => o.path)).toEqual(["orders", "order_items"]);
    });

    it("resolves a $ref to the id of a row the same batch created", async () => {
        // The capability the whole endpoint exists for: the child's foreign key
        // does not exist until the parent is inserted, so without this the two
        // halves have to be separate requests — which is precisely the
        // non-atomic sequence a batch replaces.
        const { app } = createHarness();

        const res = await batch(app, {
            operations: [
                { op: "create", collection: "orders", values: { total: 40 }, ref: "order" },
                { op: "create", collection: "order_items", values: { order_id: { $ref: "order.id" }, sku: "A-1" } }
            ]
        });

        const body = await res.json() as { data: Record<string, unknown>[] };
        expect(body.data[1].order_id).toBe(body.data[0].id);
    });

    it("resolves a $ref nested inside a value", async () => {
        const resolved = new Map([["order", { id: 7 }]]);
        expect(resolveBatchRefs({ meta: { of: { $ref: "order.id" } } }, resolved))
            .toEqual({ meta: { of: 7 } });
        expect(resolveBatchRefs([{ $ref: "order.id" }], resolved)).toEqual([7]);
    });

    it("refuses a forward $ref before the transaction opens", async () => {
        // Found at operation 0 rather than at operation 40, which is the whole
        // point: a batch is all-or-nothing, so a body that cannot work must not
        // cost the rollback of the writes before the point it fails.
        const { app, calls } = createHarness();

        const res = await batch(app, {
            operations: [
                { op: "create", collection: "order_items", values: { order_id: { $ref: "order.id" } } },
                { op: "create", collection: "orders", values: { total: 40 }, ref: "order" }
            ]
        });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_BATCH_REF");
        expect(calls).toHaveLength(0);
    });

    it("refuses two operations claiming the same ref name", async () => {
        const { app } = createHarness();

        const res = await batch(app, {
            operations: [
                { op: "create", collection: "orders", values: { total: 1 }, ref: "o" },
                { op: "create", collection: "orders", values: { total: 2 }, ref: "o" }
            ]
        });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { message: string } }).error.message).toMatch(/reuses the ref/);
    });

    it("refuses an unknown collection without touching the driver", async () => {
        const { app, calls } = createHarness();

        const res = await batch(app, {
            operations: [{ op: "create", collection: "nope", values: {} }]
        });

        expect(res.status).toBe(400);
        expect(calls).toHaveLength(0);
    });

    it("refuses an unknown field, exactly as the single-row route does", async () => {
        const { app, calls } = createHarness();

        const res = await batch(app, {
            operations: [{ op: "create", collection: "orders", values: { totl: 40 } }]
        });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code)
            .toBe("VALIDATION_UNKNOWN_FIELDS");
        expect(calls).toHaveLength(0);
    });

    it("refuses a field operation on a create", async () => {
        // `views + 1` over a row that does not exist yet is just `1`, so
        // accepting it would make `$inc` mean two different things depending on
        // a race the caller cannot observe.
        const { app } = createHarness();

        const res = await batch(app, {
            operations: [{ op: "create", collection: "orders", values: { total: { $inc: 1 } } }]
        });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code)
            .toBe("INVALID_FIELD_OPERATION");
    });

    it("accepts a field operation on an update", async () => {
        const { app, calls } = createHarness();

        const res = await batch(app, {
            operations: [{ op: "update", collection: "orders", id: 1, values: { total: { $inc: -1 } } }]
        });

        expect(res.status).toBe(200);
        expect(calls[0][0].values).toEqual({ total: { $inc: -1 } });
    });

    it("refuses an upsert on a column with no uniqueness guarantee", async () => {
        // Postgres answers 42P10 for this, from inside a transaction that has
        // already written the operations before it. A 400 naming the targets
        // that do exist costs nothing and can be acted on.
        const { app, calls } = createHarness();

        const res = await batch(app, {
            operations: [
                { op: "upsert", collection: "orders", values: { total: 1 }, onConflict: ["total"] }
            ]
        });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code)
            .toBe("INVALID_CONFLICT_TARGET");
        expect(calls).toHaveLength(0);
    });

    it("accepts an upsert on a column declared unique", async () => {
        const { app, calls } = createHarness();

        const res = await batch(app, {
            operations: [
                { op: "upsert", collection: "orders", values: { email: "a@b.c" }, onConflict: ["email"] }
            ]
        });

        expect(res.status).toBe(200);
        expect(calls[0][0].onConflict).toEqual(["email"]);
    });

    it("caps the number of operations", async () => {
        const { app } = createHarness();

        const res = await batch(app, {
            operations: Array.from({ length: 1001 }, () => ({
                op: "create", collection: "orders", values: { total: 1 }
            }))
        });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("BATCH_TOO_LARGE");
    });

    it("answers an empty batch without a round trip to the driver", async () => {
        const { app, calls } = createHarness();

        const res = await batch(app, { operations: [] });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: [], meta: { operations: 0 } });
        expect(calls).toHaveLength(0);
    });

    it("says so when the driver cannot make a batch atomic", async () => {
        // Never a fallback to a loop of single writes: that would be neither
        // atomic nor one round trip, which are the two things a caller reaches
        // for this to get.
        const { app } = createHarness({ noBatchWrite: true });

        const res = await batch(app, {
            operations: [{ op: "create", collection: "orders", values: { total: 1 } }]
        });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("BATCH_UNSUPPORTED");
    });

    it("propagates a mid-batch failure rather than reporting a partial success", async () => {
        const { app } = createHarness({ failAt: 1 });

        const res = await batch(app, {
            operations: [
                { op: "create", collection: "orders", values: { total: 1 } },
                { op: "create", collection: "orders", values: { total: 2 } }
            ]
        });

        expect(res.status).toBe(400);
    });

    it("delete entries come back as null, aligned to the operations", async () => {
        const { app } = createHarness();

        const res = await batch(app, {
            operations: [
                { op: "delete", collection: "orders", id: 1 },
                { op: "create", collection: "orders", values: { total: 2 } }
            ]
        });

        const body = await res.json() as { data: (Record<string, unknown> | null)[] };
        expect(body.data[0]).toBeNull();
        expect(body.data[1]).toMatchObject({ total: 2 });
    });

    it("needs an id on an update and on a delete", async () => {
        const { app } = createHarness();

        for (const op of ["update", "delete"]) {
            const res = await batch(app, {
                operations: [{ op, collection: "orders", values: { total: 1 } }]
            });
            expect(res.status).toBe(400);
        }
    });

    it("sends the ids only under Prefer: return=minimal", async () => {
        const { app } = createHarness();

        const res = await batch(app, {
            operations: [
                { op: "create", collection: "orders", values: { total: 1 } },
                { op: "delete", collection: "orders", id: 5 }
            ]
        }, { Prefer: "return=minimal" });

        expect(res.status).toBe(200);
        expect(res.headers.get("Preference-Applied")).toBe("return=minimal");
        const body = await res.json() as { data: unknown[] };
        expect(body.data).toEqual([100, null]);
    });
});
