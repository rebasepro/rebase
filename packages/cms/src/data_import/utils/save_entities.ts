import { CollectionAccessor, CollectionConfig, Entity, RebaseData } from "@rebasepro/types";
import { findEntitiesByIds } from "../../util/find_entities_by_ids";

/**
 * Rows written per request, and per transaction where the data source has one.
 *
 * It was 25, which made a 10,000-row import 400 sequential round trips. The
 * server takes up to 1,000 rows per `POST /bulk`; 500 keeps a failed batch's
 * rollback small enough to retry, and the byte cap below bounds the body.
 */
export const IMPORT_BATCH_SIZE = 500;

/**
 * The most JSON one batch carries, in UTF-8 bytes. ~1 MB: a tenth of the
 * server's default body limit (10 MB, `maxBodySize`), and under the 1 MiB a
 * reverse proxy commonly allows by default (nginx's `client_max_body_size`),
 * so wide rows shrink the batch instead of failing it with a 413. A row larger
 * than this still goes, alone.
 */
export const IMPORT_BATCH_MAX_BYTES = 1_000_000;

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
    /**
     * Index of the row the server named as the cause, 0-based, when it named
     * one (`Row 37: …` — every server message about one row of a bulk write
     * starts that way, counted within the batch). The message is rewritten to
     * name it the way the file does: from 1, counted from the first row.
     */
    failedRow?: number;
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

/** The body was refused for its size: a proxy's or the server's 413, or too many rows. */
function isTooLarge(error: unknown): boolean {
    const status = (error as { status?: number; statusCode?: number })?.status
        ?? (error as { statusCode?: number })?.statusCode;
    if (status === 413) return true;
    const code = (error as { code?: string })?.code;
    return code === "PAYLOAD_TOO_LARGE" || code === "BULK_TOO_LARGE";
}

/** The length of a string in UTF-8 bytes, which is what a body limit counts. */
function utf8Length(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xD800 && code <= 0xDBFF) {
            bytes += 4;
            i++;
        } else bytes += 3;
    }
    return bytes;
}

/** `{"rows":[`, `],"upsert":true}` and some slack. */
const BULK_ENVELOPE_BYTES = 64;

/**
 * Where the batch starting at `start` ends: at `maxRows` rows, or before the
 * row that would take the body past `maxBytes` — never before one row.
 */
function batchEnd(data: Partial<Entity<any>>[], start: number, maxRows: number, maxBytes: number): number {
    let bytes = BULK_ENVELOPE_BYTES;
    let end = start;
    while (end < data.length && end - start < maxRows) {
        const rowBytes = utf8Length(JSON.stringify(toBulkRow(data[end]))) + 1;
        if (end > start && bytes + rowBytes > maxBytes) break;
        bytes += rowBytes;
        end++;
    }
    return end;
}

/**
 * The row a server message names, counted within the batch, and the message
 * with that row counted the way the user's file counts it.
 */
function locateFailedRow(error: unknown, start: number): { row: number, message: string } | undefined {
    const message = (error as Error)?.message;
    if (typeof message !== "string") return undefined;
    const match = /^Row (\d+)(?: of \d+)?/.exec(message);
    if (!match) return undefined;
    const row = start + Number(match[1]);
    return { row, message: `Row ${row + 1}` + message.slice(match[0].length) };
}

function isConflict(error: unknown): boolean {
    const status = (error as { status?: number; statusCode?: number })?.status
        ?? (error as { statusCode?: number })?.statusCode;
    if (status === 409) return true;
    const code = (error as { code?: string })?.code;
    return code === "CONFLICT" || code === "23505";
}

/**
 * The server refused a row only for the required columns it leaves out.
 *
 * `POST /bulk` with `upsert: true` judges each row as a create, since it may
 * insert, so a row meant to update a stored record with some of its columns
 * (`id,price`) is refused as `'name' is required`.
 */
function isMissingRequiredOnly(error: unknown): boolean {
    const violations = (error as { details?: { violations?: unknown } })?.details?.violations;
    return Array.isArray(violations) && violations.length > 0
        && violations.every(v => (v as { code?: unknown })?.code === "required");
}

/**
 * Whether the collection's rows are the users, read the way the server reads it
 * (`collection.auth`, `true` or `{ enabled: true }`).
 *
 * The server refuses an upsert there: a create hashes the password and runs
 * `onCreateUser`, an update may not demote the last administrator, and an
 * upsert decides between the two too late to follow either rule.
 */
function isAuthCollection(collection: CollectionConfig | undefined): boolean {
    const auth = collection?.auth;
    return auth === true || (!!auth && typeof auth === "object" && auth.enabled === true);
}

/**
 * A batch split by whether each row's id is stored: the rows whose id is
 * stored are updates — the given columns are written, the rest keep their
 * values, as the per-row path and the preview's "overwritten" say — and the
 * others are created, where a new row still needs every required column. A
 * refusal of one of those names its row in `batch`.
 *
 * Used when the bulk upsert refused a batch for missing required columns
 * (the creates then go back as an upsert), and for every batch of the auth
 * collection, which takes no upsert (the creates go as a plain bulk create,
 * which the server runs through user creation).
 */
async function writeUpdatesAndCreates(accessor: CollectionAccessor,
    batch: Partial<Entity<any>>[],
    collection: CollectionConfig,
    createMany: NonNullable<CollectionAccessor["createMany"]>,
    upsert: boolean): Promise<void> {

    const ids = batch.map(entity => entity.id).filter((id): id is string | number => id !== undefined && id !== null && id !== "");
    const stored = await findEntitiesByIds(accessor, collection, ids);
    const isUpdate = (entity: Partial<Entity<any>>) => entity.id !== undefined && entity.id !== null && stored.has(String(entity.id));

    const updates = batch.filter(isUpdate);
    if (updates.length > 0) {
        if (accessor.updateMany) {
            await accessor.updateMany(updates.map(entity => ({ id: entity.id as string | number, data: entity.values ?? {} })));
        } else {
            for (const entity of updates) await accessor.update(entity.id as string | number, entity.values ?? {});
        }
    }

    const creates = batch.map((entity, index) => ({ entity, index })).filter(({ entity }) => !isUpdate(entity));
    if (creates.length === 0) return;
    try {
        const rows = creates.map(({ entity }) => toBulkRow(entity));
        await (upsert ? createMany(rows, { upsert: true }) : createMany(rows));
    } catch (e) {
        // "Row 1" of the rows sent is "Row <n>" of the batch.
        const message = (e as Error)?.message;
        const match = typeof message === "string" ? /^Row (\d+)/.exec(message) : null;
        if (match && creates[Number(match[1])]) {
            (e as Error).message = `Row ${creates[Number(match[1])].index}` + message.slice(match[0].length);
        }
        throw e;
    }
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
    written: { count: number },
    collection: CollectionConfig | undefined): Promise<void> {

    if (accessor.createMany && !bulkUnsupported.current) {
        try {
            if (collection && isAuthCollection(collection)) {
                // Not one transaction: the updates are written before the
                // creates, and a retry of the batch writes them again, to the
                // same values — while a stored id among the creates is a
                // conflict, never an overwrite of a user's password.
                await writeUpdatesAndCreates(accessor, batch, collection, accessor.createMany.bind(accessor), false);
                written.count = batch.length;
                return;
            }
            await accessor.createMany(batch.map(toBulkRow), { upsert: true });
            written.count = batch.length;
            return;
        } catch (e) {
            if (collection && !isAuthCollection(collection) && isMissingRequiredOnly(e) && batch.some(entity => entity.id !== undefined && entity.id !== null && entity.id !== "")) {
                // Not one transaction any more: a refused create leaves the
                // updates before it written, and a retry of the batch writes
                // them again, to the same values.
                await writeUpdatesAndCreates(accessor, batch, collection, accessor.createMany.bind(accessor), true);
                written.count = batch.length;
                return;
            }
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
        maxBatchBytes = IMPORT_BATCH_MAX_BYTES,
        onBatchCommitted = () => undefined,
        bulkUnsupported = { current: false },
        collection
    }: {
        offset?: number;
        batchSize?: number;
        /** See {@link IMPORT_BATCH_MAX_BYTES}. */
        maxBatchBytes?: number;
        onBatchCommitted?: (rowsWritten: number) => void;
        bulkUnsupported?: { current: boolean };
        /**
         * The collection written to. With it, a row that updates a stored
         * record with some of its columns is written as an update rather
         * than refused for the required columns it leaves out.
         */
        collection?: CollectionConfig;
    } = {}): Promise<void> {

    console.debug("Saving imported data", offset, batchSize);

    const accessor = dataClient.collection(path);

    // Lowered for the rest of the import when a batch is refused for its
    // size — a server or proxy configured below the byte cap — so an import
    // that worked in small batches does not fail in large ones.
    let maxRows = Math.max(1, batchSize);
    let start = offset;
    while (start < data.length) {
        const batch = data.slice(start, batchEnd(data, start, maxRows, maxBatchBytes));
        const written = { count: 0 };
        try {
            await writeBatch(accessor, batch, bulkUnsupported, written, collection);
        } catch (e) {
            if (written.count === 0 && batch.length > 1 && isTooLarge(e)) {
                maxRows = Math.max(1, Math.floor(batch.length / 2));
                continue;
            }
            const located = locateFailedRow(e, start + written.count);
            throw Object.assign(e as Error, {
                committed: start + written.count,
                failedFrom: start + written.count,
                failedTo: start + batch.length,
                ...(located ? { failedRow: located.row, message: located.message } : {})
            }) as ImportSaveError;
        }
        start += batch.length;
        onBatchCommitted(start);
    }

    onBatchCommitted(data.length);
}
