
import { Entity } from "@rebasepro/types";
import React, { useCallback, useMemo, useState } from "react";
import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import {
    deleteEntityWithCallbacks,
    useAuthController,
    useCustomizationController,
    useData,
    useSnackbarController,
    useTranslation
} from "@rebasepro/app";
import { useAdminContext } from "../hooks";
import { EntityViewBinding } from "./EntityViewBinding";
import type { AdminCollection } from "@rebasepro/cms-types";

export interface DeleteEntityDialogProps<M extends Record<string, unknown>> {
    entityOrEntitiesToDelete?: Entity<M> | Entity<M>[],
    path: string,
    collection: AdminCollection<M>
    open: boolean;
    onClose: () => void;

    onEntityDelete?(path: string, entity: Entity<M>): void;

    onMultipleEntitiesDelete?(path: string, entities: Entity<M>[]): void;

    /**
     * What the DELETE at this path actually does.
     *
     * `"unlink"` when the rows are shared through a junction: the server removes
     * the link and leaves the row alone, so a dialog promising deletion would be
     * describing something else.
     */
    variant?: "delete" | "unlink";
}

export function DeleteEntityDialog<M extends Record<string, unknown>>({
    entityOrEntitiesToDelete,
    collection,
    onClose,
    open,
    onEntityDelete,
    onMultipleEntitiesDelete,
    path,
    variant = "delete"
}: DeleteEntityDialogProps<M>) {
    const authController = useAuthController();
    const dataClient = useData();
    const customizationController = useCustomizationController();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);

    const context = useAdminContext();
    const entityOrEntities = Array.isArray(entityOrEntitiesToDelete) && entityOrEntitiesToDelete.length === 1
        ? entityOrEntitiesToDelete[0]
        : entityOrEntitiesToDelete;

    const multipleEntities = Array.isArray(entityOrEntities);

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
            onDeleteSuccess,
            onDeleteFailure,
            context
        }), [dataClient, collection, onDeleteSuccess, onDeleteFailure, context]);

    const handleOk = useCallback(async () => {
        if (entityOrEntities) {

            setLoading(true);

            if (multipleEntities) {
                Promise.all((entityOrEntities as Entity<M>[]).map(performDelete)).then((results) => {

                    setLoading(false);

                    if (onMultipleEntitiesDelete && entityOrEntities)
                        onMultipleEntitiesDelete(path, entityOrEntities as Entity<M>[]);

                    if (results.every(Boolean)) {
                        snackbarController.open({
                            type: "success",
                            message: t("multiple_deleted", { collection: collection.name })
                        });
                    } else if (results.some(Boolean)) {
                        snackbarController.open({
                            type: "warning",
                            message: t("some_entities_deleted", { collection: collection.name })
                        });
                    } else {
                        snackbarController.open({
                            type: "error",
                            message: t("error_deleting_entities", { collection: collection.name })
                        });
                    }
                    onClose();
                });

            } else {
                performDelete(entityOrEntities as Entity<M>).then((success) => {
                    setLoading(false);
                    if (success) {
                        if (onEntityDelete && entityOrEntities)
                            onEntityDelete(path, entityOrEntities as Entity<M>);
                        snackbarController.open({
                            type: "success",
                            message: t("deleted", { name: collection.singularName ?? collection.name })
                        });
                        onClose();
                    }
                });
            }
        }
    }, [entityOrEntities, multipleEntities, performDelete, onMultipleEntitiesDelete, path, onClose, snackbarController, collection.name, onEntityDelete]);

    let content: React.ReactNode;
    if (entityOrEntities && multipleEntities) {
        content = <>{t("multiple_entities")}</>;
    } else {
        const entity = entityOrEntities as Entity<M> | undefined;
        content = entity
            ? <EntityViewBinding
                entity={entity}
                collection={collection}
                path={path}/>
            : <></>;
    }

    const entityName = collection.singularName ?? collection.name;

    const dialogTitle = variant === "unlink"
        ? (multipleEntities
            ? <><b>{collection.name}</b>: {t("confirm_multiple_unlink") ?? "Remove these from this record?"}</>
            : (t("unlink_entity_confirm_title", { entityName }) ?? `Remove this ${entityName} from this record?`))
        : (multipleEntities
            ? <><b>{collection.name}</b>: {t("confirm_multiple_delete")}</>
            : t("delete_entity_confirm_title", { entityName }));

    return (
        <Dialog
            maxWidth={multipleEntities ? "lg" : "2xl"}
            aria-labelledby="delete-dialog"
            open={open}
            onOpenChange={(open) => !open ? onClose() : undefined}
        >
            <DialogTitle id="delete-dialog-title">
                {dialogTitle}
            </DialogTitle>
            <DialogContent fullHeight={true}>
                {variant === "unlink" && <div className={"px-4 pt-4"}>
                    <Typography variant={"body2"} color={"secondary"}>
                        {t("unlink_entity_confirm_body", { collectionName: collection.name })
                            ?? `It stays in ${collection.name} and remains available to other records.`}
                    </Typography>
                </div>}
                {!multipleEntities && <div className={"p-4"}>{content}</div>}
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
