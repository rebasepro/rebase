import { Entity } from "@rebasepro/types";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import {
    deleteEntityWithCallbacks,
    useData,
    useSnackbarController,
    useTranslation
} from "@rebasepro/app";
import { useAdminContext } from "../hooks";
import { EntityViewBinding } from "./EntityViewBinding";
import type { AdminCollection, EntitySelection } from "@rebasepro/cms-types";
import { resolveSelection } from "../selection";
import { mapWithConcurrency } from "../util/map_with_concurrency";

/**
 * Deletes in flight at once.
 *
 * The bulk delete used to be `Promise.all(entities.map(performDelete))`, which
 * is unremarkable for the handful of rows anyone could tick by hand and
 * untenable the moment "select all 12,480 matching" can reach it.
 */
const DELETE_CONCURRENCY = 8;

export interface DeleteEntityDialogProps<M extends Record<string, unknown>> {
    /**
     * What to delete: one row, or a whole selection.
     *
     * A selection may be a *query* — every row matching a filter, most of them
     * never read. That is why this is not an `Entity[]`: the rows do not exist
     * until {@link resolveSelection} reads them, and it only does that once the
     * user has confirmed.
     */
    target?: Entity<M> | EntitySelection<M>,
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

function isSelection<M extends Record<string, unknown>>(
    target: Entity<M> | EntitySelection<M>
): target is EntitySelection<M> {
    return (target as EntitySelection<M>).type === "entities" || (target as EntitySelection<M>).type === "query";
}

export function DeleteEntityDialog<M extends Record<string, unknown>>({
    target,
    collection,
    onClose,
    open,
    onEntityDelete,
    onMultipleEntitiesDelete,
    path,
    variant = "delete"
}: DeleteEntityDialogProps<M>) {
    const dataClient = useData();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<string | undefined>(undefined);
    const cancelledRef = useRef({ aborted: false });

    const context = useAdminContext();

    // A one-row selection is a single delete: the dialog shows that row rather
    // than the anonymous "these entities" copy, which is what anyone ticking
    // exactly one checkbox expects to see.
    const { singleEntity, selection } = useMemo(() => {
        if (!target)
            return { singleEntity: undefined,
                selection: undefined };
        if (!isSelection(target))
            return { singleEntity: target,
                selection: undefined };
        if (target.type === "entities" && target.entities.length === 1)
            return { singleEntity: target.entities[0],
                selection: undefined };
        return { singleEntity: undefined,
            selection: target };
    }, [target]);

    /** How many rows this will delete; `undefined` when only the server knows. */
    const selectionCount = selection === undefined
        ? 1
        : selection.type === "entities"
            ? selection.entities.length
            : selection.count === undefined
                ? undefined
                : Math.max(0, selection.count - selection.excluded.length);

    const handleCancel = useCallback(() => {
        cancelledRef.current.aborted = true;
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

        if (singleEntity) {
            setLoading(true);
            const success = await performDelete(singleEntity);
            setLoading(false);
            if (success) {
                onEntityDelete?.(path, singleEntity);
                snackbarController.open({
                    type: "success",
                    message: t("deleted", { name: collection.singularName ?? collection.name })
                });
                onClose();
            }
            return;
        }

        if (!selection) return;

        setLoading(true);
        cancelledRef.current = { aborted: false };

        let entities: Entity<M>[];
        try {
            // Reading happens *after* the confirmation, not before it: a query
            // selection over a large collection is tens of requests, and doing
            // them up front would make clicking the bin — an action the user has
            // not yet agreed to — the expensive part.
            entities = await resolveSelection<M>({
                selection,
                accessor: dataClient.collection<M>(path),
                signal: cancelledRef.current,
                onProgress: (loaded, total) => setProgress(
                    total === undefined
                        ? (t("selection_reading_rows_unknown", { loaded: loaded.toLocaleString() }) ?? `Reading rows… ${loaded}`)
                        : (t("selection_reading_rows", {
                            loaded: loaded.toLocaleString(),
                            total: total.toLocaleString()
                        }) ?? `Reading rows… ${loaded} of ${total}`)
                )
            });
        } catch (e) {
            setLoading(false);
            setProgress(undefined);
            snackbarController.open({
                type: "error",
                title: t("error_deleting_entities", { collection: collection.name }),
                message: (e as Error)?.message
            });
            return;
        }

        if (cancelledRef.current.aborted) {
            setLoading(false);
            setProgress(undefined);
            return;
        }

        let results: boolean[] = [];
        try {
            results = await mapWithConcurrency(
                entities,
                DELETE_CONCURRENCY,
                // Cancel has to reach the deletes too, not just the read that
                // precedes them. It cannot recall the ones already in flight,
                // but it stops the queue — otherwise closing the dialog on a
                // 12,000-row delete would leave it running with nothing on
                // screen saying so.
                (entity) => cancelledRef.current.aborted
                    ? Promise.resolve(false)
                    : performDelete(entity),
                (completed, total) => setProgress(t("selection_deleting_progress", {
                    completed: completed.toLocaleString(),
                    total: total.toLocaleString()
                }) ?? `Deleted ${completed} of ${total}`)
            );
        } catch (e) {
            // `mapWithConcurrency` runs every task before it rethrows, so the
            // rows that could be deleted have been. The per-row failure handler
            // has already reported the cause.
            console.error("Error deleting entities", e);
        }

        setLoading(false);
        setProgress(undefined);

        onMultipleEntitiesDelete?.(path, entities.filter((_, i) => results[i]));

        const deleted = results.filter(Boolean).length;
        if (deleted === entities.length && entities.length > 0) {
            snackbarController.open({
                type: "success",
                message: t("multiple_deleted", { collection: collection.name })
            });
        } else if (deleted > 0) {
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
    }, [singleEntity, selection, performDelete, dataClient, path, onEntityDelete, onMultipleEntitiesDelete, onClose, snackbarController, collection.name, collection.singularName, t]);

    const entityName = collection.singularName ?? collection.name;

    let dialogTitle: React.ReactNode;
    if (singleEntity) {
        dialogTitle = variant === "unlink"
            ? (t("unlink_entity_confirm_title", { entityName }) ?? `Remove this ${entityName} from this record?`)
            : t("delete_entity_confirm_title", { entityName });
    } else if (variant === "unlink") {
        dialogTitle = <><b>{collection.name}</b>: {t("confirm_multiple_unlink") ?? "Remove these from this record?"}</>;
    } else if (selectionCount === undefined) {
        // "Every matching row, and the server has not said how many." Naming a
        // number here would be inventing one for an irreversible action.
        dialogTitle = t("confirm_delete_selection_unknown") ?? "Delete every row matching the current filter?";
    } else {
        dialogTitle = t("confirm_delete_selection", {
            total: selectionCount.toLocaleString(),
            collection: collection.name
        }) ?? `Delete ${selectionCount.toLocaleString()} ${collection.name}?`;
    }

    return (
        <Dialog
            maxWidth={singleEntity ? "2xl" : "lg"}
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
                {singleEntity && <div className={"p-4"}>
                    <EntityViewBinding
                        entity={singleEntity}
                        collection={collection}
                        path={path}/>
                </div>}
                {!singleEntity && variant === "delete" && <div className={"px-4 pt-4"}>
                    <Typography variant={"body2"} color={"secondary"}>
                        {t("confirm_delete_selection_body")
                            ?? "This cannot be undone. Each row is deleted individually, so this may take a while."}
                    </Typography>
                </div>}
            </DialogContent>
            <DialogActions>

                {loading && <CircularProgress size={"smallest"}/>}
                {progress && <Typography variant={"caption"} color={"secondary"}>{progress}</Typography>}

                <Button onClick={handleCancel}
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
