import { CollectionAccessor, Entity, RebaseData } from "@rebasepro/types";

/** Rows written per request, and per transaction where the data source has one. */
export const IMPORT_BATCH_SIZE = 25;

/**
 * An import failure that says where it stopped.
 *
 * "Error saving data / null value in column "sku" violates not-null constraint"
 * on a ten-thousand-row import named no row, and the Retry button restarted at
 * zero — where the rows already written now conflicted, so it could never
 * succeed. Both halves of that are what this carries.
 */
export interface ImportSaveError extends Error {
    /** Rows written and confirmed before the failure. Where a retry resumes. */
    committed: number;
    /** Index of the first row that was not written, 0-based. */
    failedFrom: number;
    /** Index after the last row of the batch that was not written. */
    failedTo: number;
}

/** The row a bulk write takes: the values, with the chosen id as a column. */
function toBulkRow(entity: Partial<Entity<any>>): Record<string, unknown> {
    const values = { ...(entity.values ?? {}) } as Record<string, unknown>;
    if (entity.id !== undefined && entity.id !== null && entity.id !== "") {
        // Exactly what single-row `create(values, id)` puts on the wire.
        values.id = entity.id;
    }
    return values;
}

function isBulkUnsupported(error: unknown): boolean {
    if ((error as { code?: string })?.code === "BULK_UNSUPPORTED") return true;
    const message = (error as Error)?.message ?? "";
    return /bulk writes are not supported|does not support bulk/i.test(message);
}

function isConflict(error: unknown): boolean {
    const status = (error as { status?: number; statusCode?: number })?.status
        ?? (error as { statusCode?: number })?.statusCode;
    if (status === 409) return true;
    const code = (error as { code?: string })?.code;
    return code === "CONFLICT" || code === "23505";
}

/**
 * Write one batch, all-or-nothing wherever the data source can.
 *
 * `POST /<collection>/bulk` validates every row before the transaction opens,
 * names a failure by row index, and takes the `upsert` flag the preview screen
 * promises — none of which one `create` per row inside a `Promise.all` could
 * offer, since `Promise.all` does not cancel its siblings and every request was
 * its own transaction.
 */
async function writeBatch(accessor: CollectionAccessor,
    batch: Partial<Entity<any>>[],
    bulkUnsupported: { current: boolean },
    written: { count: number }): Promise<void> {

    if (accessor.createMany && !bulkUnsupported.current) {
        try {
            await accessor.createMany(batch.map(toBulkRow), { upsert: true });
            written.count = batch.length;
            return;
        } catch (e) {
            if (!isBulkUnsupported(e)) throw e;
            // A data source without bulk writes: remember it, so the failed
            // round trip is not paid again on every later batch.
            bulkUnsupported.current = true;
        }
    }

    // Sequential, not `Promise.all`: a rejected write does not cancel its
    // siblings, so a parallel batch commits an indeterminate subset of itself
    // and nobody can say which rows landed.
    for (const entity of batch) {
        try {
            await accessor.create(entity.values ?? {}, entity.id);
        } catch (e) {
            // Without `/bulk` there is no upsert, so the preview's promise is
            // honoured the only way left: a row that collided on an id the user
            // supplied is overwritten. A row with no id had nothing to collide
            // on, and every other failure is still a failure.
            if (entity.id === undefined || !isConflict(e)) throw e;
            await accessor.update(entity.id, entity.values ?? {});
        }
        written.count++;
    }
}

/**
 * Write imported entities in batches, reporting what was committed.
 *
 * Resumable on purpose: a failure at row 4 000 leaves rows 1–3 999 in the table
 * whatever this does, so the only useful thing to report is where to carry on
 * from. `offset` is that point — the Retry button passes back the `committed`
 * count of the error it is retrying, instead of starting from zero and
 * conflicting on every row that already exists.
 *
 * @throws {ImportSaveError} naming the rows that were not written.
 */
export async function saveImportedEntities(dataClient: RebaseData,
    path: string,
    data: Partial<Entity<any>>[],
    {
        offset = 0,
        batchSize = IMPORT_BATCH_SIZE,
        onBatchCommitted = () => undefined,
        bulkUnsupported = { current: false }
    }: {
        offset?: number;
        batchSize?: number;
        onBatchCommitted?: (rowsWritten: number) => void;
        bulkUnsupported?: { current: boolean };
    } = {}): Promise<void> {

    console.debug("Saving imported data", offset, batchSize);

    const accessor = dataClient.collection(path);

    for (let start = offset; start < data.length; start += batchSize) {
        const batch = data.slice(start, start + batchSize);
        const written = { count: 0 };
        try {
            await writeBatch(accessor, batch, bulkUnsupported, written);
        } catch (e) {
            throw Object.assign(e as Error, {
                committed: start + written.count,
                failedFrom: start + written.count,
                failedTo: start + batch.length
            }) as ImportSaveError;
        }
        onBatchCommitted(start + batch.length);
    }

    onBatchCommitted(data.length);
}
