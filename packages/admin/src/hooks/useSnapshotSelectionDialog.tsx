import { SnapshotSelectionProps, SnapshotSelectionTable } from "../components";
import type { SnapshotCollection } from "@rebasepro/types";
import { useCallback, useMemo } from "react";
import { useSideDialogsController } from "../index";
import { useCollectionRegistryController } from "../index";

/**
 * This hook is used to open a side dialog that allows the selection
 * of snapshots under a given path.
 * You can use it in custom views for selecting snapshots.
 * You need to specify the path of the target collection at least.
 * If your collection is not defined in your  top collection configuration
 * (in your `Rebase` component), you need to specify explicitly.
 * This is the same hook used internally when a reference property is defined.
 * @group Hooks and utilities
 */
export function useSnapshotSelectionDialog<M extends Record<string, unknown>>(referenceDialogProps: Omit<SnapshotSelectionProps<M>, "path"> & {
    path?: string | false;
    onClose?: () => void;
}): { open: () => void; close: () => void } {

    const navigation = useCollectionRegistryController();
    const sideDialogsController = useSideDialogsController();

    const open = useCallback(() => {
        if (referenceDialogProps.path) {
            let usedCollection = referenceDialogProps.collection;
            if (!usedCollection)
                usedCollection = navigation.getCollection(referenceDialogProps.path) as SnapshotCollection<M> | undefined;
            if (!usedCollection)
                throw Error("Not able to resolve the collection in useSnapshotSelectionDialog. Make sure a collection is registered in path " + referenceDialogProps.path);
            sideDialogsController.open({
                key: `reference_${referenceDialogProps.path}`,
                component:
                    <SnapshotSelectionTable
                        collection={usedCollection}
                        {...referenceDialogProps as SnapshotSelectionProps<M>}/>,
                width: "90vw",
                onClose: () => {
                    referenceDialogProps.onClose?.();
                }
            });
        } else {
            throw Error("useReferenceDialog: You are trying to open a reference dialog, but have not declared the `path`")
        }
    }, [navigation, referenceDialogProps, sideDialogsController]);

    const close = useCallback(() => {
        sideDialogsController.close();
    }, [sideDialogsController]);

    return useMemo(() => ({
        open,
        close
    }), [open, close]);

}
