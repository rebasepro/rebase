import { describe, expect, test } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import { type CollectionConfig, type Entity } from "@rebasepro/cms-types";
import { saveImportedEntities } from "../../src/data_import/utils/save_entities";
import { entityOf, foundRows, idsAskedFor, importAccessor, importClient } from "./import_accessor";

/**
 * Repricing by id: a CSV of `id,price` over products whose `name` is required.
 *
 * The import sends every batch as `POST /bulk` with `upsert: true`, and the
 * server judges each upsert row as a create, since it may insert — so the
 * file was refused with `Row 0: 'name' is required.` and nothing was written,
 * after the preview promised "entities with the same id will be overwritten".
 * A row whose id exists is an update of it: the given columns are written and
 * the rest keep their stored values.
 */

const products: CollectionConfig = {
    slug: "products",
    name: "Products",
    properties: {
        id: { type: "string", isId: "manual" },
        name: { type: "string", validation: { required: true } },
        price: { type: "number" }
    }
};

function makeClient(existing: Record<string, Record<string, unknown>>) {
    const stored = new Map(Object.entries(existing));
    const calls = { createMany: 0, updateMany: 0, find: 0 };
    const missingRequired = (row: Record<string, unknown>, rowIndex: number) => new RebaseApiError(
        `Row ${rowIndex}: 'name' is required.`,
        {
            status: 400,
            code: "VALIDATION_CONSTRAINT",
            details: { violations: [{ field: "name", code: "required", message: "'name' is required." }] }
        });
    const storedEntity = (id: string) => entityOf(id, "products", stored.get(id));
    const accessor = importAccessor({
        async findById(id) {
            return stored.has(String(id)) ? storedEntity(String(id)) : undefined;
        },
        async find(params) {
            calls.find++;
            return foundRows(idsAskedFor(params).filter(id => stored.has(id)).map(storedEntity));
        },
        async createMany(rows, options) {
            calls.createMany++;
            // As the server does: an upsert row may insert, so `required` holds.
            rows.forEach((row, index) => {
                if (row.name === undefined || row.name === null) throw missingRequired(row, index);
            });
            expect(options?.upsert).toBe(true);
            rows.forEach(row => stored.set(String(row.id), { ...(stored.get(String(row.id)) ?? {}), ...row }));
            return rows.map(row => entityOf(String(row.id), "products", row));
        },
        async updateMany(updates) {
            calls.updateMany++;
            updates.forEach(({ id }) => {
                if (!stored.has(String(id))) throw new RebaseApiError("Not found", { status: 404 });
            });
            updates.forEach(({ id, data }) => stored.set(String(id), { ...stored.get(String(id)), ...data }));
            return updates.map(({ id, data }) => entityOf(id, "products", data));
        }
    });
    return { dataClient: importClient(accessor), stored, calls };
}

const row = (id: string, values: Record<string, unknown>): Partial<Entity> => ({ id, path: "products", values });

describe("an import that updates existing rows with some of their columns", () => {
    test("updates the rows whose id exists, keeping the columns it does not carry", async () => {
        const { dataClient, stored } = makeClient({
            "p-1": { id: "p-1", name: "Lamp", price: 10 },
            "p-2": { id: "p-2", name: "Desk", price: 20 }
        });

        await saveImportedEntities(dataClient, "products", [row("p-1", { price: 11 }), row("p-2", { price: 21 })], { collection: products });

        expect(stored.get("p-1")).toEqual({ id: "p-1", name: "Lamp", price: 11 });
        expect(stored.get("p-2")).toEqual({ id: "p-2", name: "Desk", price: 21 });
    });

    test("still creates the new rows of the same batch", async () => {
        const { dataClient, stored } = makeClient({ "p-1": { id: "p-1", name: "Lamp", price: 10 } });

        await saveImportedEntities(dataClient, "products", [
            row("p-1", { price: 11 }),
            row("p-9", { name: "Chair", price: 5 })
        ], { collection: products });

        expect(stored.get("p-1")).toEqual({ id: "p-1", name: "Lamp", price: 11 });
        expect(stored.get("p-9")).toMatchObject({ name: "Chair", price: 5 });
    });

    test("a new row missing a required column is still refused, named by its row in the file", async () => {
        const { dataClient } = makeClient({ "p-1": { id: "p-1", name: "Lamp", price: 10 } });

        await expect(saveImportedEntities(dataClient, "products", [
            row("p-1", { price: 11 }),
            row("p-9", { price: 5 })
        ], { collection: products })).rejects.toMatchObject({ message: "Row 2: 'name' is required.", failedRow: 1 });
    });

    test("a full file costs one request per batch, as before", async () => {
        const { dataClient, calls } = makeClient({});

        await saveImportedEntities(dataClient, "products", [row("p-1", { name: "Lamp" }), row("p-2", { name: "Desk" })], { collection: products });

        expect(calls).toEqual({ createMany: 1, updateMany: 0, find: 0 });
    });
});
