import type { CollectionConfig } from "@rebasepro/types";
import { Entity, CollectionCallbacks } from "@rebasepro/types";
import React, { useCallback, useMemo, useState } from "react";
import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from "@rebasepro/ui";
import {
    deleteEntityWithCallbacks,
    useAuthController,
    useCustomizationController,
    useData,
    useSnackbarController,
    useTranslation
} from "@rebasepro/core";
import { useCMSContext } from "../hooks";
import { EntityViewBinding } from "./EntityViewBinding";

export interface DeleteEntityDialogProps<M extends Record<string, unknown>> {
    entityOrEntitysToDelete?: Entity<M> | Entity<M>[],
    path: string,
    collection: CollectionConfig<M>
    open: boolean;
    onClose: () => void;
    callbacks?: CollectionCallbacks<M>,

    onEntityDelete?(path: string, entity: Entity<M>): void;

    onMultipleEntitysDelete?(path: string, entitys: Entity<M>[]): void;
}

export function DeleteEntityDialog<M extends Record<string, unknown>>({
    entityOrEntitysToDelete,
    collection,
    onClose,
    open,
    callbacks,
    onEntityDelete,
    onMultipleEntitysDelete,
    path
}: DeleteEntityDialogProps<M>) {
    const authController = useAuthController();
    const dataClient = useData();
    const customizationController = useCustomizationController();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);

    const context = useCMSContext();
    const entityOrEntitys = Array.isArray(entityOrEntitysToDelete) && entityOrEntitysToDelete.length === 1
        ? entityOrEntitysToDelete[0]
        : entityOrEntitysToDelete;

    const multipleEntitys = Array.isArray(entityOrEntitys);

    const handleCancel = useCallback(() => {
        onClose();
    }, [onClose]);

    const onDeleteSuccess = useCallback((entity: Entity<any>) => {
        console.debug("Deleted", entity);
    }, []);

    const onDeleteFailure = useCallback((entity: Entity<any>, e: Error) => {
        snackbarController.open({
            type: "error",
            title: t("error_deleting"),
            message: e?.message
        });

        console.error("Error deleting entity");
        console.error(e);
    }, [collection.name]);

    const performDelete = useCallback((entity: Entity<M>): Promise<boolean> =>
        deleteEntityWithCallbacks({
            data: dataClient,
            entity,
            collection: collection,
            callbacks,
            onDeleteSuccess,
            onDeleteFailure,
            context
        }), [dataClient, collection, callbacks, onDeleteSuccess, onDeleteFailure, context]);

    const handleOk = useCallback(async () => {
        if (entityOrEntitys) {

            setLoading(true);

            if (multipleEntitys) {
                Promise.all((entityOrEntitys as Entity<M>[]).map(performDelete)).then((results) => {

                    setLoading(false);

                    if (onMultipleEntitysDelete && entityOrEntitys)
                        onMultipleEntitysDelete(path, entityOrEntitys as Entity<M>[]);

                    if (results.every(Boolean)) {
                        snackbarController.open({
                            type: "success",
                            message: t("multiple_deleted", { collection: collection.name })
                        });
                    } else if (results.some(Boolean)) {
                        snackbarController.open({
                            type: "warning",
                            message: t("some_entitys_deleted", { collection: collection.name })
                        });
                    } else {
                        snackbarController.open({
                            type: "error",
                            message: t("error_deleting_entitys", { collection: collection.name })
                        });
                    }
                    onClose();
                });

            } else {
                performDelete(entityOrEntitys as Entity<M>).then((success) => {
                    setLoading(false);
                    if (success) {
                        if (onEntityDelete && entityOrEntitys)
                            onEntityDelete(path, entityOrEntitys as Entity<M>);
                        snackbarController.open({
                            type: "success",
                            message: t("deleted", { name: collection.singularName ?? collection.name })
                        });
                        onClose();
                    }
                });
            }
        }
    }, [entityOrEntitys, multipleEntitys, performDelete, onMultipleEntitysDelete, path, onClose, snackbarController, collection.name, onEntityDelete]);

    let content: React.ReactNode;
    if (entityOrEntitys && multipleEntitys) {
        content = <>{t("multiple_entitys")}</>;
    } else {
        const entity = entityOrEntitys as Entity<M> | undefined;
        content = entity
            ? <EntityViewBinding
                entity={entity}
                collection={collection}
                path={path}/>
            : <></>;
    }

    const dialogTitle = multipleEntitys
        ? <><b>{collection.name}</b>: {t("confirm_multiple_delete")}</>
        : t("delete_entity_confirm_title", { entityName: collection.singularName ?? collection.name });

    return (
        <Dialog
            maxWidth={multipleEntitys ? "lg" : "2xl"}
            aria-labelledby="delete-dialog"
            open={open}
            onOpenChange={(open) => !open ? onClose() : undefined}
        >
            <DialogTitle id="delete-dialog-title">
                {dialogTitle}
            </DialogTitle>
            <DialogContent fullHeight={true}>
                {!multipleEntitys && <div className={"p-4"}>{content}</div>}
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
