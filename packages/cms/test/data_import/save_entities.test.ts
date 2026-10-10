import { describe, expect, test } from "@jest/globals";
import { Entity, RebaseApiError, RebaseData } from "@rebasepro/types";
import { ImportSaveError, saveImportedEntities } from "../../src/data_import/utils/save_entities";

/** The body a common reverse proxy accepts by default (nginx: `1m`). */
const ONE_MIB = 1024 * 1024;

/** Await an import that must fail, and hand back the error it failed with. */
async function importFailure(promise: Promise<void>): Promise<ImportSaveError> {
    try {
        await promise;
    } catch (e) {
        return e as ImportSaveError;
    }
    throw new Error("Expected the import to fail, but it succeeded");
}

function rows(count: number, idPrefix = "row"): Partial<Entity<any>>[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `${idPrefix}-${i}`,
        path: "orders",
        values: { index: i }
    }));
}

/**
 * A data client that behaves like the REST one: `create` on an id that already
 * exists is a 409, and `createMany` writes the whole batch or none of it.
 */
function makeClient(options: {
    existingIds?: string[];
    bulk?: boolean;
    failOnId?: string;
    bulkUnsupported?: boolean;
    /** Refuse a bulk body with more rows than this, as a 413 would. */
    maxRowsPerRequest?: number;
} = {}) {
    const stored = new Map<string, Record<string, unknown>>();
    (options.existingIds ?? []).forEach(id => stored.set(id, {}));
    const calls = { create: 0,
        createMany: 0,
        update: 0,
        // UTF-8 size of each bulk body, as the server's body limit counts it.
        bodyBytes: [] as number[] };

    const accessor: Record<string, unknown> = {
        async create(values: Record<string, unknown>, id?: string) {
            calls.create++;
            if (id === options.failOnId) throw new Error(`null value in column "sku" violates not-null constraint`);
            if (id !== undefined && stored.has(id)) {
                throw new RebaseApiError(`Record with id ${id} already exists`, { status: 409 });
            }
            if (id !== undefined) stored.set(id, values);
            return { id,
                path: "orders",
                values };
        },
        async update(id: string, values: Record<string, unknown>) {
            calls.update++;
            if (!stored.has(id)) throw new RebaseApiError("Not found", { status: 404 });
            stored.set(id, values);
            return { id,
                path: "orders",
                values };
        }
    };

    if (options.bulk !== false) {
        accessor.createMany = async (batch: Record<string, unknown>[], writeOptions?: { upsert?: boolean }) => {
            calls.createMany++;
            calls.bodyBytes.push(unescape(encodeURIComponent(JSON.stringify({ rows: batch, upsert: writeOptions?.upsert }))).length);
            if (options.maxRowsPerRequest !== undefined && batch.length > options.maxRowsPerRequest) {
                throw new RebaseApiError("Request body too large.", { status: 413 });
            }
            if (options.bulkUnsupported) {
                throw new RebaseApiError("This collection's data source does not support bulk writes.", {
                    status: 400
                });
            }
            // All-or-nothing, and validated before anything is written.
            batch.forEach((row) => {
                if (row.id === options.failOnId) {
                    throw new Error(`Row ${batch.indexOf(row)} of ${batch.length} (id ${JSON.stringify(row.id)}) failed: null value in column "sku" violates not-null constraint`);
                }
                if (!writeOptions?.upsert && typeof row.id === "string" && stored.has(row.id)) {
                    throw new RebaseApiError(`Record with id ${row.id} already exists`, { status: 409 });
                }
            });
            batch.forEach((row) => stored.set(String(row.id), row));
            return batch.map(row => ({ id: row.id,
                path: "orders",
                values: row }));
        };
    }

    const dataClient = { collection: () => accessor } as unknown as RebaseData;
    return { dataClient,
        stored,
        calls,
        // Mutable so a test can correct the offending row and retry, which is
        // the whole point of resuming.
        options };
}

describe("saveImportedEntities", () => {

    test("writes every row in batches", async () => {
        const { dataClient, stored, calls } = makeClient();

        await saveImportedEntities(dataClient, "orders", rows(60), { batchSize: 25 });

        expect(stored.size).toEqual(60);
        expect(calls.createMany).toEqual(3);
        expect(calls.create).toEqual(0);
    });

    test("overwrites rows whose id already exists, as the preview promises", async () => {
        // `create(values, id)` becomes a plain insert with no `upsert`, so a
        // pre-existing id used to 409 and abort the whole import — after the
        // preview said in writing that it would be overwritten.
        const { dataClient, stored } = makeClient({ existingIds: ["row-0", "row-3"] });

        await saveImportedEntities(dataClient, "orders", rows(5), { batchSize: 25 });

        expect(stored.size).toEqual(5);
        expect(stored.get("row-3")).toEqual({ index: 3,
            id: "row-3" });
    });

    test("reports the rows that were not written, and where to resume", async () => {
        const { dataClient } = makeClient({ failOnId: "row-30" });

        const error = await importFailure(saveImportedEntities(dataClient, "orders", rows(60), { batchSize: 25 }));

        expect(error.message).toMatch(/not-null constraint/);
        expect(error.committed).toEqual(25);
        expect(error.failedFrom).toEqual(25);
        expect(error.failedTo).toEqual(50);
    });

    test("a retry resumes from the last committed row instead of conflicting forever", async () => {
        const { dataClient, stored, calls, options } = makeClient({ failOnId: "row-30" });
        const data = rows(60);

        const error = await importFailure(saveImportedEntities(dataClient, "orders", data, { batchSize: 25 }));
        expect(stored.size).toEqual(25);

        // The offending row is corrected and the import retried from where it
        // stopped — restarting at zero re-sent 25 rows that now exist.
        options.failOnId = undefined;
        const callsBefore = calls.createMany;
        await saveImportedEntities(dataClient, "orders", data, {
            offset: error.committed,
            batchSize: 25
        });

        expect(stored.size).toEqual(60);
        expect(calls.createMany - callsBefore).toEqual(2);
    });

    test("reports progress by rows committed", async () => {
        const { dataClient } = makeClient();
        const progress: number[] = [];

        await saveImportedEntities(dataClient, "orders", rows(60), {
            batchSize: 25,
            onBatchCommitted: (written) => progress.push(written)
        });

        expect(progress).toEqual([25, 50, 60, 60]);
    });

    describe("batch size", () => {

        test("a 10,000-row import makes at most 20 requests, none over the byte cap", async () => {
            const { dataClient, stored, calls } = makeClient();

            await saveImportedEntities(dataClient, "orders", rows(10_000));

            expect(stored.size).toEqual(10_000);
            expect(calls.createMany).toBeLessThanOrEqual(20);
            expect(Math.max(...calls.bodyBytes)).toBeLessThan(ONE_MIB);
        });

        test("wide rows make smaller batches rather than an oversized body", async () => {
            const { dataClient, stored, calls } = makeClient();
            // ~10 KB a row, multi-byte characters included: 500 of them would
            // be a 5 MB body.
            const wide = rows(1_000).map(row => ({ ...row,
                values: { ...row.values,
                    text: "é".repeat(5_000) } }));

            await saveImportedEntities(dataClient, "orders", wide);

            expect(stored.size).toEqual(1_000);
            expect(Math.max(...calls.bodyBytes)).toBeLessThan(ONE_MIB);
            expect(calls.createMany).toBeLessThanOrEqual(12);
        });

        test("a failing batch names the row the server named, counted from the file's first row", async () => {
            const { dataClient, stored, options } = makeClient({ failOnId: "row-4321" });
            const data = rows(10_000);

            const error = await importFailure(saveImportedEntities(dataClient, "orders", data));

            expect(error.committed).toEqual(4_000);
            expect(error.failedFrom).toEqual(4_000);
            expect(error.failedTo).toEqual(4_500);
            expect(error.failedRow).toEqual(4_321);
            // The server counts within the batch, from 0; the user's file
            // counts from its first row, from 1.
            expect(error.message).toMatch(/^Row 4322 \(id "row-4321"\) failed: null value/);
            expect(stored.size).toEqual(4_000);

            options.failOnId = undefined;
            await saveImportedEntities(dataClient, "orders", data, { offset: error.committed });
            expect(stored.size).toEqual(10_000);
        });

        test("a server that refuses the batch size gets smaller batches, not a failed import", async () => {
            const { dataClient, stored, calls } = makeClient({ maxRowsPerRequest: 100 });

            await saveImportedEntities(dataClient, "orders", rows(1_000));

            expect(stored.size).toEqual(1_000);
            // 500 and 250 refused once each, then 125-row batches... until
            // one fits: 62.
            expect(calls.createMany).toBeLessThanOrEqual(1_000 / 62 + 4);
        });
    });

    describe("data sources without bulk writes", () => {

        test("falls back to one write per row, and overwrites on a conflict", async () => {
            const { dataClient, stored, calls } = makeClient({ bulk: false,
                existingIds: ["row-1"] });

            await saveImportedEntities(dataClient, "orders", rows(3), { batchSize: 25 });

            expect(stored.size).toEqual(3);
            expect(calls.create).toEqual(3);
            expect(calls.update).toEqual(1);
        });

        test("names the exact row that failed", async () => {
            const { dataClient } = makeClient({ bulk: false,
                failOnId: "row-7" });

            const error = await importFailure(saveImportedEntities(dataClient, "orders", rows(10), { batchSize: 25 }));

            // Sequential writes, so the seven rows before it really are written
            // and the eighth really is the one that was not.
            expect(error.committed).toEqual(7);
            expect(error.failedFrom).toEqual(7);
        });

        test("a server that rejects bulk writes falls back without failing the import", async () => {
            const { dataClient, stored, calls } = makeClient({ bulkUnsupported: true });

            await saveImportedEntities(dataClient, "orders", rows(30), { batchSize: 25 });

            expect(stored.size).toEqual(30);
            // Tried once, then never again.
            expect(calls.createMany).toEqual(1);
            expect(calls.create).toEqual(30);
        });
    });
});
