import { useCallback, useMemo } from "react";
import { setIn } from "@rebasepro/formex";
import { CollectionConfig, RebaseData, RebaseContext } from "@rebasepro/types";
import { OnCellValueChange, saveSnapshotWithCallbacks, SaveSnapshotWithCallbacksProps, UniqueFieldValidator } from "@rebasepro/core";

export interface UseCollectionInlineEditorParams<M extends Record<string, unknown>> {
    path: string;
    collection: CollectionConfig<M>;
    dataClient: RebaseData;
    context: RebaseContext;
}

export function useCollectionInlineEditor<M extends Record<string, unknown>>({
    path,
    collection,
    dataClient,
    context
}: UseCollectionInlineEditorParams<M>) {

    // Unique field validator (ported from CollectionViewBinding)
    const uniqueFieldValidator: UniqueFieldValidator = useCallback(
        async ({ name, value, property, snapshotId }: Parameters<UniqueFieldValidator>[0]) => {
            const accessor = dataClient.collection(path);
            const res = await accessor.find({
                where: { [name]: ["==", value] }
            });

            const conflictingSnapshots = res.data;
            const isUnique = conflictingSnapshots.length === 0 ||
                (conflictingSnapshots.length === 1 && conflictingSnapshots[0].id === snapshotId);

            return isUnique;
        },
        [path, dataClient]
    );

    // Partial update payload builder
    const onValueChange: OnCellValueChange<any, any> = useCallback(({
        value,
        propertyKey,
        onValueUpdated,
        setError,
        data: snapshot
    }) => {
        if (!snapshot) return;

        const updatedValues = setIn({}, propertyKey, value) as Partial<Record<string, unknown>>;

        const saveProps: SaveSnapshotWithCallbacksProps<Record<string, unknown>> = {
            path: snapshot.path ?? path,
            snapshotId: snapshot.id,
            values: updatedValues,
            previousValues: snapshot.values,
            collection,
            status: "existing"
        };

        return saveSnapshotWithCallbacks({
            ...saveProps,
            collection,
            data: dataClient,
            context,
            afterSave: () => {
                setError(undefined);
                onValueUpdated();
            },
            afterSaveError: (e: Error) => {
                console.error("Save failure");
                console.error(e);
                setError(e);
            }
        }).then();

    }, [path, collection, dataClient, context]);

    return useMemo(() => ({
        onValueChange,
        uniqueFieldValidator
    }), [onValueChange, uniqueFieldValidator]);
}
