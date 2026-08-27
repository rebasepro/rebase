/**
 * The admin needs one addressable token per row; the row itself carries only
 * columns. This is the seam where the address is minted — from the collection's
 * primary keys, not from anything the server wrote into the payload.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { buildRebaseData } from "../src/data/buildRebaseData";
import { DataDriver } from "@rebasepro/types";

const rows: Record<string, Record<string, unknown>[]> = {
    products: [{ id: 42,
name: "Camera" }],
    sku_items: [{ sku: "ABC-1",
label: "Widget" }],
    memberships: [{ tenant_id: 1,
user_id: 2,
role: "admin" }],
    legacy: [{ id: "L1",
name: "From another driver" }],
    unkeyed: [{ name: "No key declared" }]
};

const collections: Record<string, { properties: Record<string, unknown> }> = {
    products: { properties: { id: { type: "number",
isId: "increment" },
name: { type: "string" } } },
    sku_items: { properties: { sku: { type: "string",
isId: true },
label: { type: "string" } } },
    memberships: {
        properties: {
            tenant_id: { type: "number",
isId: true },
            user_id: { type: "number",
isId: true },
            role: { type: "string" }
        }
    },
    // Declares no key at all — not addressable from the config.
    unkeyed: { properties: { name: { type: "string" } } }
};

const makeDriver = (): DataDriver => ({
    fetchCollection: jest.fn(async ({ path }: { path: string }) => rows[path] ?? []),
    fetchOne: jest.fn(async ({ path }: { path: string }) => rows[path]?.[0]),
    save: jest.fn(),
    delete: jest.fn()
} as unknown as DataDriver);

const dataWith = (resolve?: (slug: string) => { properties?: Record<string, unknown> } | undefined) =>
    buildRebaseData(makeDriver(), resolve ? { resolveCollection: resolve } : undefined);

describe("rowToEntity — the address is derived, not carried", () => {

    it("derives the address from a numeric key while the row keeps its real type", async () => {
        const data = dataWith(slug => collections[slug]);
        const { data: entities } = await data.collection("products").find();

        expect(entities[0].id).toBe("42");
        // The row is untouched: still a number, still just columns.
        expect(entities[0].values).toEqual({ id: 42,
name: "Camera" });
        expect(typeof entities[0].values.id).toBe("number");
    });

    it("addresses a row whose key is not called `id`", async () => {
        const data = dataWith(slug => collections[slug]);
        const { data: entities } = await data.collection("sku_items").find();

        expect(entities[0].id).toBe("ABC-1");
        expect(entities[0].values).toEqual({ sku: "ABC-1",
label: "Widget" });
    });

    it("joins a composite key into one addressable token", async () => {
        const data = dataWith(slug => collections[slug]);
        const { data: entities } = await data.collection("memberships").find();

        expect(entities[0].id).toBe("1:::2");
        expect(entities[0].values).toEqual({ tenant_id: 1,
user_id: 2,
role: "admin" });
    });

    it("falls back to a row's own id when no keys resolve", async () => {
        // Drivers other than postgres still serve rows carrying an id; without
        // this the admin would lose addressing for every one of them.
        const data = dataWith(() => undefined);
        const { data: entities } = await data.collection("legacy").find();

        expect(entities[0].id).toBe("L1");
    });

    it("warns once when a collection declares no key", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const data = dataWith(slug => collections[slug]);
            await data.collection("unkeyed").find();
            await data.collection("unkeyed").find();

            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain("declares no primary key");
        } finally {
            warn.mockRestore();
        }
    });

    it("resolves late, so a registry registered after the data layer still works", async () => {
        // <Rebase> builds the data layer above <RebaseCMS>, which owns the
        // collections — so the resolver is registered after the fact. A miss
        // must not be memoized, or the collection stays address-less forever.
        let registry: Record<string, { properties: Record<string, unknown> }> = {};
        const data = buildRebaseData(makeDriver(), {
            resolveCollection: slug => registry[slug]
        });

        const before = await data.collection("products").find();
        expect(before.data[0].id).toBe(42); // no keys yet: falls back to row.id

        registry = collections;

        const after = await data.collection("products").find();
        expect(after.data[0].id).toBe("42"); // derived once the registry arrives
    });
});
