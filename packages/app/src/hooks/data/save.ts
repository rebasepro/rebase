
import { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import { writeWithSaveCallbacks } from "./writeCallbacks";
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
    /**
     * The version the edit was made against — the edited entity's
     * {@link Entity.etag}. An update is then refused with `412
     * PRECONDITION_FAILED` if the record has changed since, rather than
     * writing over the change. Ignored for a create.
     */
    ifMatch?: string;
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
 * unrelated to the collection's. Both run: the collection's first. A
 * collection `afterSave` that throws does not undo the save: the write has
 * committed, so it is reported as a warning and the caller's `afterSave` runs.
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
    ifMatch,
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

    const accessor = data.collection(path);
    return writeWithSaveCallbacks<M, Entity<M>>({
        collection,
        path,
        entityId,
        values,
        previousValues,
        status,
        context,
        write: (valuesToSave) => (status === "new" || status === "copy"
            ? accessor.create(valuesToSave, entityId)
            : ifMatch
                ? accessor.update(entityId!, valuesToSave, { ifMatch })
                : accessor.update(entityId!, valuesToSave)) as Promise<Entity<M>>,
        // `entity.values`, not the values sent: "after save" means the row as
        // saved, and the two differ whenever the write path adds something. The
        // auth create response carries `temporaryPassword` / `invitationSent`
        // beside the columns, and the panel's own injected afterSave — the one
        // that shows the credentials dialog — can only read them here.
        saved: (entity) => ({ id: entity.id, values: entity.values }),
        afterSave,
        afterSaveError
    });
}
