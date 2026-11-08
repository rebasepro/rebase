import type { EntityStatus, EntityValues } from "@rebasepro/types";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";

/**
 * One write, inside the collection's `browserCallbacks` — the semantics
 * `saveEntityWithCallbacks` documents, for any transport: the form's
 * save over `useData()` and `useRowWrites` over the flat layer run the same
 * callbacks, in the same order, with the same values.
 *
 * @param write sends the values `beforeSave` returned
 * @param saved the record as written, in the admin's view model, for `afterSave`
 * @internal
 */
export async function writeWithSaveCallbacks<M extends Record<string, unknown>, R>({
    collection,
    path,
    entityId,
    values,
    previousValues,
    status,
    context,
    write,
    saved,
    afterSave,
    afterSaveError
}: {
    collection: AdminCollection<M>;
    path: string;
    entityId?: string | number;
    values: Partial<EntityValues<M>>;
    previousValues?: Partial<EntityValues<M>>;
    status: EntityStatus;
    context: RebaseContext;
    write: (values: Partial<EntityValues<M>>) => Promise<R>;
    saved: (result: R) => { id: string | number; values: EntityValues<M> };
    afterSave?: (result: R) => void;
    afterSaveError?: (e: Error) => void;
}): Promise<R> {

    const browserCallbacks = collection.browserCallbacks;

    let valuesToSave = values;
    if (browserCallbacks?.beforeSave) {
        try {
            valuesToSave = await browserCallbacks.beforeSave({
                collection,
                path,
                id: entityId,
                values,
                previousValues,
                status,
                context
            });
        } catch (e) {
            // A throw here means "do not save", so the write never starts. The
            // caller still needs to hear about it, and so does afterSaveError:
            // to the form this is indistinguishable from a rejected write.
            const error = e instanceof Error ? e : new Error(String(e));
            await browserCallbacks.afterSaveError?.({
                collection,
                path,
                id: entityId,
                values,
                previousValues,
                status,
                error,
                context
            });
            if (afterSaveError) afterSaveError(error);
            throw error;
        }
    }

    let result: R;
    try {
        result = await write(valuesToSave);
    } catch (e) {
        await browserCallbacks?.afterSaveError?.({
            collection,
            path,
            id: entityId,
            values: valuesToSave,
            previousValues,
            status,
            error: e as Error,
            context
        });
        if (afterSaveError) afterSaveError(e as Error);
        throw e;
    }

    // Awaited, and before the caller's: an afterSave that writes a related
    // row should have finished before the form closes over it.
    //
    // The write has committed by now, so a throw here is not a failed save.
    // It used to be reported as one: the form stayed on "new", and the next
    // Save created a second row. It is said for what it is, and the save
    // completes.
    if (browserCallbacks?.afterSave) {
        try {
            const record = saved(result);
            await browserCallbacks.afterSave({
                collection,
                path,
                id: record.id,
                values: record.values,
                previousValues,
                status,
                context
            });
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error(`afterSave of "${path}" failed after the record was saved`, error);
            context.snackbarController?.open({ type: "warning", message: error.message });
        }
    }
    if (afterSave)
        afterSave(result);
    return result;
}

/**
 * One delete, inside the collection's `browserCallbacks` — `beforeDelete`,
 * then `afterDelete` — as `deleteEntityWithCallbacks` runs them, for any
 * transport. Rejects without deleting when `beforeDelete` throws, and rejects
 * when the delete fails or, after it, when `afterDelete` throws.
 *
 * @param row the record, `{ id, ...values }` in the admin's view model, as both callbacks get it
 * @param remove deletes the record
 * @internal
 */
export async function deleteWithCallbacks<M extends Record<string, unknown>>({
    collection,
    path,
    id,
    row,
    context,
    remove
}: {
    collection: AdminCollection<M>;
    path: string;
    id: string | number;
    row: Record<string, unknown>;
    context: RebaseContext;
    remove: () => Promise<void>;
}): Promise<void> {
    const browserCallbacks = collection.browserCallbacks;
    if (browserCallbacks?.beforeDelete) {
        try {
            await browserCallbacks.beforeDelete({ collection, path, id, row, context });
        } catch (e) {
            throw e instanceof Error ? e : new Error(String(e));
        }
    }
    await remove();
    await browserCallbacks?.afterDelete?.({ collection, path, id, row, context });
}

