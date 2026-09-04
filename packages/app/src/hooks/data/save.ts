
import { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import { RebaseContext, AdminCollection } from "@rebasepro/cms-types";
import { RebaseData } from "@rebasepro/types";

/**
 * @group Hooks and utilities
 */
export type SaveEntityWithCallbacksProps<M extends Record<string, unknown>> = {
    path: string;
    values: Partial<EntityValues<M>>;
    entityId?: string | number;
    previousValues?: Partial<EntityValues<M>>;
    collection?: AdminCollection<M>;
    status: EntityStatus;
    afterSave?: (updatedEntity: Entity<M>) => void,
    afterSaveError?: (e: Error) => void
}

/**
 * This function is in charge of saving a entity.
 *
 * It runs the collection's **`admin.browserCallbacks`** around the write —
 * `beforeSave`, then `afterSave` or `afterSaveError`. Not `callbacks`: that
 * block belongs to the server, which runs it inside the write it serves, and
 * its bodies are stripped from this bundle entirely.
 *
 * Which matters most for a collection on a `direct`/`custom` transport, where
 * the panel talks to the store itself and no server sees the write at all —
 * before this ran them, such a collection had no write callbacks anywhere. This
 * function has been named `saveEntityWithCallbacks` since it was written and
 * did not run any.
 *
 * A `beforeSave` that throws blocks the write, exactly as the server's does:
 * nothing is sent, and the error reaches `afterSaveError` and the caller.
 *
 * `afterSave`/`afterSaveError` below are the *caller's* UI callbacks — the
 * form's "close the dialog", the table's "clear the editing state" — and are
 * unrelated to the collection's. Both run: the collection's first.
 *
 * @param collection
 * @param path
 * @param entityId
 * @param values
 * @param previousValues
 * @param status
 * @param data
 * @param context
 * @param afterSave
 * @param afterSaveError
 * @group Hooks and utilities
 */
export async function saveEntityWithCallbacks<M extends Record<string, unknown>>({
    collection,
    path,
    entityId,
    values,
    previousValues,
    status,
    data,
    context,
    afterSave,
    afterSaveError
}: Omit<SaveEntityWithCallbacksProps<M>, "collection"> & {
    collection: AdminCollection<M>,
    data: RebaseData,
    context: RebaseContext,
}
): Promise<Entity<M>> {

    if (status !== "new" && status !== "copy" && !entityId) {
        throw new Error("Entity id must be specified when updating an existing entity");
    }

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
                context
            });
            if (afterSaveError) afterSaveError(error);
            throw error;
        }
    }

    const accessor = data.collection(path);

    let savePromise: Promise<Entity<M>>;
    if (status === "new" || status === "copy") {
        savePromise = accessor.create(valuesToSave, entityId) as Promise<Entity<M>>;
    } else {
        savePromise = accessor.update(entityId!, valuesToSave) as Promise<Entity<M>>;
    }

    return savePromise.then(async (entity) => {
        // Awaited, and before the caller's: an afterSave that writes a related
        // row should have finished before the form closes over it.
        //
        // `entity.values`, not the values sent: "after save" means the row as
        // saved, and the two differ whenever the write path adds something. The
        // auth create response carries `temporaryPassword` / `invitationSent`
        // beside the columns, and the panel's own injected afterSave — the one
        // that shows the credentials dialog — can only read them here.
        await browserCallbacks?.afterSave?.({
            collection,
            path,
            id: entity.id,
            values: entity.values,
            previousValues,
            status,
            context
        });
        if (afterSave)
            afterSave(entity);
        return entity as Entity<M>;
    }).catch(async (e) => {
        await browserCallbacks?.afterSaveError?.({
            collection,
            path,
            id: entityId,
            values: valuesToSave,
            previousValues,
            status,
            context
        });
        if (afterSaveError) afterSaveError(e);
        throw e;
    });
}
