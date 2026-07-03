import type { SnapshotCollection } from "@rebasepro/types";
import { Snapshot, CollectionCallbacks } from "@rebasepro/types";
import React, { useCallback, useMemo, useState } from "react";
import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from "@rebasepro/ui";
import {
    deleteSnapshotWithCallbacks,
    useAuthController,
    useCustomizationController,
    useData,
    useSnackbarController,
    useTranslation
} from "@rebasepro/core";
import { useCMSContext } from "../hooks";
import { SnapshotView } from "./SnapshotView";

export interface DeleteSnapshotDialogProps<M extends Record<string, unknown>> {
    snapshotOrSnapshotsToDelete?: Snapshot<M> | Snapshot<M>[],
    path: string,
    collection: SnapshotCollection<M>
    open: boolean;
    onClose: () => void;
    callbacks?: CollectionCallbacks<M>,

    onSnapshotDelete?(path: string, snapshot: Snapshot<M>): void;

    onMultipleSnapshotsDelete?(path: string, snapshots: Snapshot<M>[]): void;
}

export function DeleteSnapshotDialog<M extends Record<string, unknown>>({
    snapshotOrSnapshotsToDelete,
    collection,
    onClose,
    open,
    callbacks,
    onSnapshotDelete,
    onMultipleSnapshotsDelete,
    path
}: DeleteSnapshotDialogProps<M>) {
    const authController = useAuthController();
    const dataClient = useData();
    const customizationController = useCustomizationController();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);

    const context = useCMSContext();
    const snapshotOrSnapshots = Array.isArray(snapshotOrSnapshotsToDelete) && snapshotOrSnapshotsToDelete.length === 1
        ? snapshotOrSnapshotsToDelete[0]
        : snapshotOrSnapshotsToDelete;

    const multipleSnapshots = Array.isArray(snapshotOrSnapshots);

    const handleCancel = useCallback(() => {
        onClose();
    }, [onClose]);

    const onDeleteSuccess = useCallback((snapshot: Snapshot<any>) => {
        console.debug("Deleted", snapshot);
    }, []);

    const onDeleteFailure = useCallback((snapshot: Snapshot<any>, e: Error) => {
        snackbarController.open({
            type: "error",
            title: t("error_deleting"),
            message: e?.message
        });

        console.error("Error deleting snapshot");
        console.error(e);
    }, [collection.name]);

    const performDelete = useCallback((snapshot: Snapshot<M>): Promise<boolean> =>
        deleteSnapshotWithCallbacks({
            data: dataClient,
            snapshot,
            collection: collection,
            callbacks,
            onDeleteSuccess,
            onDeleteFailure,
            context
        }), [dataClient, collection, callbacks, onDeleteSuccess, onDeleteFailure, context]);

    const handleOk = useCallback(async () => {
        if (snapshotOrSnapshots) {

            setLoading(true);

            if (multipleSnapshots) {
                Promise.all((snapshotOrSnapshots as Snapshot<M>[]).map(performDelete)).then((results) => {

                    setLoading(false);

                    if (onMultipleSnapshotsDelete && snapshotOrSnapshots)
                        onMultipleSnapshotsDelete(path, snapshotOrSnapshots as Snapshot<M>[]);

                    if (results.every(Boolean)) {
                        snackbarController.open({
                            type: "success",
                            message: t("multiple_deleted", { collection: collection.name })
                        });
                    } else if (results.some(Boolean)) {
                        snackbarController.open({
                            type: "warning",
                            message: t("some_snapshots_deleted", { collection: collection.name })
                        });
                    } else {
                        snackbarController.open({
                            type: "error",
                            message: t("error_deleting_snapshots", { collection: collection.name })
                        });
                    }
                    onClose();
                });

            } else {
                performDelete(snapshotOrSnapshots as Snapshot<M>).then((success) => {
                    setLoading(false);
                    if (success) {
                        if (onSnapshotDelete && snapshotOrSnapshots)
                            onSnapshotDelete(path, snapshotOrSnapshots as Snapshot<M>);
                        snackbarController.open({
                            type: "success",
                            message: t("deleted", { name: collection.singularName ?? collection.name })
                        });
                        onClose();
                    }
                });
            }
        }
    }, [snapshotOrSnapshots, multipleSnapshots, performDelete, onMultipleSnapshotsDelete, path, onClose, snackbarController, collection.name, onSnapshotDelete]);

    let content: React.ReactNode;
    if (snapshotOrSnapshots && multipleSnapshots) {
        content = <>{t("multiple_snapshots")}</>;
    } else {
        const snapshot = snapshotOrSnapshots as Snapshot<M> | undefined;
        content = snapshot
            ? <SnapshotView
                snapshot={snapshot}
                collection={collection}
                path={path}/>
            : <></>;
    }

    const dialogTitle = multipleSnapshots
        ? <><b>{collection.name}</b>: {t("confirm_multiple_delete")}</>
        : t("delete_snapshot_confirm_title", { snapshotName: collection.singularName ?? collection.name });

    return (
        <Dialog
            maxWidth={multipleSnapshots ? "lg" : "2xl"}
            aria-labelledby="delete-dialog"
            open={open}
            onOpenChange={(open) => !open ? onClose() : undefined}
        >
            <DialogTitle id="delete-dialog-title">
                {dialogTitle}
            </DialogTitle>
            <DialogContent fullHeight={true}>
                {!multipleSnapshots && <div className={"p-4"}>{content}</div>}
            </DialogContent>
            <DialogActions>

                {loading && <CircularProgress size={"smallest"}/>}

                <Button onClick={handleCancel}
                    disabled={loading}
                    variant="text">
                    {t("cancel")}
                </Button>
                <Button
                    autoFocus
                    disabled={loading}
                    onClick={handleOk}
                    variant="filled">
                    {t("ok")}
                </Button>
            </DialogActions>

        </Dialog>
    );
}
