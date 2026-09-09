import { EntityRelation } from "@rebasepro/types";
import type { CollectionAccessor, DataDriver, RebaseData } from "@rebasepro/types";
import { buildRebaseData } from "../src/data/buildRebaseData";

/**
 * The admin's view model, built in the browser from the row the wire serves.
 *
 * The wire has one shape for every consumer: flat columns, RFC 3339 dates, and
 * a relation rendered as the target's own columns (or only its foreign key).
 * The panel renders neither directly — its date field requires a real `Date`
 * and rejects a string outright, its relation cells read `.data.values` off a
 * ref — so the conversion happens here, from the collection config the panel
 * already has.
 *
 * This is the half that did not exist on 2026-09-09, when the realtime wire was
 * unified onto the REST rendering: every date cell in the panel read "Invalid
 * date value" and every relation cell "Unexpected value", on the public demo,
 * with the whole suite green. These are the assertions that were missing.
 */
describe("the admin's view model, from a flat row", () => {

    const customers = {
        slug: "customers",
        name: "Customers",
        properties: {
            id: { type: "string", isId: true },
            first_name: { type: "string" },
            joined_at: { type: "date" }
        }
    };

    const orders = {
        slug: "orders",
        name: "Orders",
        properties: {
            id: { type: "string", isId: true },
            order_number: { type: "string" },
            order_date: { type: "date" },
            shipping: { type: "map", properties: { promised_for: { type: "date" } } },
            customer: {
                type: "relation",
                relation: { kind: "belongsTo", target: () => customers, localKey: "customer_id" }
            }
        }
    };

    const resolveCollection = (slug: string) =>
        (slug === "orders" ? orders : slug === "customers" ? customers : undefined) as never;

    const driverServing = (row: Record<string, unknown>): DataDriver => ({
        fetchCollection: jest.fn().mockResolvedValue([row]),
        fetchOne: jest.fn().mockResolvedValue(row),
        save: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(1)
    } as unknown as DataDriver);

    const read = async (row: Record<string, unknown>) => {
        const data: RebaseData = buildRebaseData(driverServing(row), { resolveCollection });
        const accessor = data.collection("orders") as CollectionAccessor;
        const res = await accessor.find();
        return res.data[0].values as Record<string, unknown>;
    };

    it("turns a declared date column into a Date", async () => {
        const values = await read({ id: "o1", order_date: "2026-08-24T00:37:57.512Z" });

        expect(values.order_date).toBeInstanceOf(Date);
        expect((values.order_date as Date).toISOString()).toBe("2026-08-24T00:37:57.512Z");
    });

    it("keeps a date the driver already typed", async () => {
        const already = new Date("2026-08-24T00:37:57.512Z");
        const values = await read({ id: "o1", order_date: already });

        expect(values.order_date).toBe(already);
    });

    it("reads a date nested in a map", async () => {
        const values = await read({ id: "o1", shipping: { promised_for: "2026-09-01T10:00:00.000Z" } });

        expect((values.shipping as Record<string, unknown>).promised_for).toBeInstanceOf(Date);
    });

    it("leaves an undeclared column exactly as the wire sent it", async () => {
        const values = await read({ id: "o1", order_number: "ORD-1", _internal: "2026-08-24T00:37:57.512Z" });

        expect(values.order_number).toBe("ORD-1");
        expect(values._internal).toBe("2026-08-24T00:37:57.512Z");
    });

    it("turns an included relation into a ref with the target's values attached", async () => {
        const values = await read({
            id: "o1",
            customer_id: "c1",
            customer: { id: "c1", first_name: "Ada", joined_at: "2020-01-02T03:04:05.000Z" }
        });

        const relation = values.customer as EntityRelation;
        expect(relation).toBeInstanceOf(EntityRelation);
        expect(relation.path).toBe("customers");
        expect(relation.id).toBe("c1");
        // Attached, so a relation cell renders without a second fetch...
        expect((relation.data as { values: Record<string, unknown> }).values.first_name).toBe("Ada");
        // ...and the target's own dates are the view model's too.
        expect((relation.data as { values: Record<string, unknown> }).values.joined_at).toBeInstanceOf(Date);
    });

    it("builds an addressable ref from the foreign key when nothing included it", async () => {
        // What `listenById` serves: it takes no `include`, so the record form
        // gets the key and nothing else. Left alone, the form shows an empty
        // chip where the customer goes.
        const values = await read({ id: "o1", customerId: "c1" });

        const relation = values.customer as EntityRelation;
        expect(relation).toBeInstanceOf(EntityRelation);
        expect(relation.id).toBe("c1");
        expect(relation.path).toBe("customers");
        expect(relation.data).toBeUndefined();
    });

    it("passes a ref through untouched, for a driver that sends one", async () => {
        const ref = new EntityRelation("c1", "customers", { id: "c1", path: "customers", values: {} });
        const values = await read({ id: "o1", customer: ref });

        expect(values.customer).toBe(ref);
    });

    it("does nothing at all without a collection resolver", async () => {
        // Which is every consumer that is not the admin — `buildSdkData`
        // derives the flat SDK from this same layer and must keep the wire's
        // own types.
        const data: RebaseData = buildRebaseData(driverServing({ id: "o1", order_date: "2026-08-24T00:37:57.512Z" }));
        const res = await (data.collection("orders") as CollectionAccessor).find();

        expect((res.data[0].values as Record<string, unknown>).order_date).toBe("2026-08-24T00:37:57.512Z");
    });
});
