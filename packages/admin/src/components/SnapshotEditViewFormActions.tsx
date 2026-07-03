
import type { SnapshotCollection } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import type { SnapshotAction, SnapshotActionClickProps, SideSnapshotController } from "@rebasepro/types";
import React, { useMemo } from "react";
import { Snapshot, getCollectionDataPath, RebaseContext } from "@rebasepro/types";
import type { SnapshotFormActionsProps } from "../types/components/SnapshotFormActionsProps";
import { copySnapshotAction, deleteSnapshotAction } from "../components";
import { mergeSnapshotActions } from "../util/snapshot_actions";
import { resolveSnapshotAction } from "../util/resolutions";
import { Button, CircularProgress, cls, defaultBorderMixin, DialogActions, IconButton, LoadingButton, Tooltip, Typography } from "@rebasepro/ui";
import { AlertCircleIcon, iconSize } from "@rebasepro/ui";
import {
    useCustomizationController,
    useSnackbarController,
    useTranslation
} from "@rebasepro/core";
import { SideDialogController, useSideDialogContext } from "./SideDialogs";
import { FormexController } from "@rebasepro/formex";
import { ErrorTooltip } from "@rebasepro/core";
import { usePermissions } from "@rebasepro/core";
import { useCMSContext } from "../index";

export function SnapshotEditViewFormActions({
    collection,
    path,
    snapshot,
    layout,
    savingError,
    formex,
    disabled,
    status,
    pluginActions,
    openSnapshotMode,
    showDefaultActions = true,
    navigateBack,
    formContext
}: SnapshotFormActionsProps) {

    const { canCreate, canDelete } = usePermissions();
    const context = useCMSContext();
    const sideSnapshotController = context.sideSnapshotController;
    const sideDialogContext = useSideDialogContext();
    const customizationController = useCustomizationController();
    const { t } = useTranslation();

    const snapshotActions = useMemo((): SnapshotAction[] => {
        const customSnapshotActions = (collection.snapshotActions ?? [])
            .map(action => resolveSnapshotAction(action, customizationController.snapshotActions))
            .filter(Boolean) as SnapshotAction[];
        const createEnabled = canCreate(collection, path);
        const deleteEnabled = snapshot ? canDelete(collection, path, snapshot) : false;
        const disableActions = collection.disableDefaultActions ?? [];
        const actions: SnapshotAction[] = [];
        if (createEnabled && !disableActions.includes("copy"))
            actions.push(copySnapshotAction);
        if (deleteEnabled && !disableActions.includes("delete"))
            actions.push(deleteSnapshotAction);
        if (customSnapshotActions)
            return mergeSnapshotActions(actions, customSnapshotActions);
        return actions;
    }, [canCreate, canDelete, collection, path, customizationController.snapshotActions?.length, snapshot, collection.disableDefaultActions]);

    const formActions = showDefaultActions ? snapshotActions.filter(a => a.includeInForm === undefined || a.includeInForm) : [];

    // HMR reload trigger
    const bottomActions = buildBottomActions({
        savingError,
        snapshot,
        formActions,
        collection,
        context,
        sideSnapshotController,
        disabled,
        status,
        sideDialogContext,
        pluginActions,
        openSnapshotMode,
        navigateBack,
        formContext,
        formex,
        t,
        className: layout === "responsive" ? "@6xl:hidden" : undefined
    });

    const sideActions = buildSideActions({
        savingError,
        snapshot,
        formActions,
        collection,
        context,
        sideSnapshotController,
        sideDialogContext,
        disabled,
        status,
        pluginActions,
        openSnapshotMode,
        navigateBack,
        formContext,
        formex,
        t,
        className: layout === "responsive" ? "hidden @6xl:flex" : undefined
    });

    if (layout === "responsive") {
        return <>
            {bottomActions}
            {sideActions}
        </>;
    }

    return layout === "bottom" ? bottomActions : sideActions;
}

type ActionsViewProps<M extends Record<string, unknown>> = {
    savingError: Error | undefined,
    snapshot: Snapshot<M> | undefined,
    formActions: SnapshotAction[],
    collection: SnapshotCollection,
    context: RebaseContext,
    sideSnapshotController: SideSnapshotController,
    disabled: boolean,
    status: "new" | "existing" | "copy",
    sideDialogContext: SideDialogController,
    pluginActions?: React.ReactNode[],
    openSnapshotMode?: "side_panel" | "full_screen" | "split" | "dialog";
    navigateBack: () => void;
    formContext: FormContext,
    formex: FormexController<Record<string, unknown>>;
    t: (key: string, vars?: Record<string, string>) => string;
    className?: string;
};

function buildBottomActions<M extends Record<string, unknown>>({
    savingError,
    snapshot,
    formActions,
    collection,
    context,
    sideSnapshotController,
    disabled,
    status,
    sideDialogContext,
    pluginActions,
    openSnapshotMode,
    navigateBack,
    formContext,
    formex,
    t,
    className
}: ActionsViewProps<M>) {

    const hasErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;
    const canClose = openSnapshotMode === "side_panel" || openSnapshotMode === "dialog";
    return <DialogActions
        className={className}
        position={"absolute"}>
        {savingError &&
            <div className="text-right">
                <Typography color={"error"}>{savingError.message}</Typography>
            </div>
        }

        {formActions.length > 0 && <div className="grow flex overflow-auto no-scrollbar">
            {formActions.map((action, index) => {


                const props = {
                    view: "form",
                    snapshot,
                    path: getCollectionDataPath(collection),
                    collection: collection,
                    context,
                    sideSnapshotController,
                    openSnapshotMode,
                    navigateBack,
                    formContext
                } satisfies SnapshotActionClickProps<Record<string, unknown>>;

                const isEnabled = !action.isEnabled || action.isEnabled(props);
                return (
                    <SnapshotActionButton
                        key={action.key ?? action.name ?? index}
                        action={action}
                        enabled={isEnabled}
                        props={props}
                    />
                );
            })}
        </div>}

        {pluginActions}

        {hasErrors ?
            <ErrorTooltip title={"This form has errors"}>
                <AlertCircleIcon className="ml-4 text-red-500" size={iconSize.smallest}/>
            </ErrorTooltip> : null}
        <Button variant="text"
            color="primary"
            disabled={disabled || formex.isSubmitting}
            type="reset">
            {status === "existing" ? t("discard") : t("clear")}
        </Button>
        {collection.defaultSnapshotAction === "view" && status === "existing" && (
            <Button variant="text"
                color="primary"
                disabled={disabled}
                onClick={navigateBack}>
                {t("back_to_detail") ?? "Back to details"}
            </Button>
        )}
        <Tooltip title={hasErrors ? (t("fix_errors_before_saving") ?? "Fix highlighted errors before saving") : undefined}>
            <Button variant={canClose ? "text" : "filled"}
                color="primary"
                type="submit"
                disabled={disabled || formex.isSubmitting}
                onClick={() => {
                    sideDialogContext.setPendingClose(false);
                }}>
                {status === "existing" && t("save")}
                {status === "copy" && t("create_copy")}
                {status === "new" && t("create")}
            </Button>
        </Tooltip>
        {canClose && <LoadingButton variant="filled"
            color="primary"
            type="submit"
            loading={formex.isSubmitting}
            disabled={disabled}
            onClick={() => {
                sideDialogContext.setPendingClose?.(true);
            }}>
            {status === "existing" && t("save_and_close")}
            {status === "copy" && t("create_copy_and_close")}
            {status === "new" && t("create_and_close")}
        </LoadingButton>}
    </DialogActions>;
}

function buildSideActions<M extends Record<string, unknown>>({
    savingError,
    snapshot,
    formActions,
    collection,
    context,
    sideSnapshotController,
    disabled,
    status,
    sideDialogContext,
    pluginActions,
    openSnapshotMode,
    navigateBack,
    formContext,
    formex,
    t,
    className
}: ActionsViewProps<M>) {

    const hasErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;
    return <div
        className={cls("overflow-auto h-full flex flex-col gap-2 w-80 2xl:w-96 px-4 py-16 sticky top-0 border-l", defaultBorderMixin, className)}>
        <Tooltip title={hasErrors ? (t("fix_errors_before_saving") ?? "Fix highlighted errors before saving") : undefined}>
            <LoadingButton fullWidth={true}
                variant="filled"
                color="primary"
                type="submit"
                loading={formex.isSubmitting}
                startIcon={hasErrors ? <AlertCircleIcon/> : undefined}
                disabled={disabled || formex.isSubmitting}
                onClick={() => {
                    sideDialogContext.setPendingClose?.(false);
                }}>
                {status === "existing" && t("save")}
                {status === "copy" && t("create_copy")}
                {status === "new" && t("create")}
            </LoadingButton>
        </Tooltip>

        <Button fullWidth={true} variant="text" disabled={disabled || formex.isSubmitting} type="reset">
            {status === "existing" ? t("discard") : t("clear")}
        </Button>
        {collection.defaultSnapshotAction === "view" && status === "existing" && (
            <Button fullWidth={true} variant="text" disabled={disabled} onClick={navigateBack}>
                {t("back_to_detail") ?? "Back to details"}
            </Button>
        )}

        {pluginActions}

        {formActions.length > 0 && <div className="flex flex-row flex-wrap mt-2">
            {formActions.map((action, index) => {
                const props = {
                    view: "form",
                    snapshot,
                    path: getCollectionDataPath(collection),
                    collection: collection,
                    context,
                    sideSnapshotController,
                    openSnapshotMode,
                    navigateBack,
                    formContext
                } satisfies SnapshotActionClickProps<Record<string, unknown>>;
                const isEnabled = !action.isEnabled || action.isEnabled(props);
                return (
                    <SnapshotActionButton key={action.key ?? action.name ?? index} action={action} enabled={isEnabled} props={props}/>
                );
            })}
        </div>}

        {savingError &&
            <div className="text-right">
                <Typography color={"error"}>{savingError.message}</Typography>
            </div>
        }
    </div>;
}

function SnapshotActionButton({
    action,
    enabled,
    props
}: {
    action: SnapshotAction,
    enabled: boolean,
    props: SnapshotActionClickProps<Record<string, unknown>>
}) {
    const snackbarController = useSnackbarController();
    const [loading, setLoading] = React.useState(false);
    return <Tooltip
        title={action.name}>
        <IconButton
            color="primary"
            disabled={!enabled}
            onClick={(event) => {
                console.debug("Executing action", action.key, props);
                try {
                    event.stopPropagation();
                    if (props.snapshot) {
                        const onClick = action.onClick(props);
                        // If the action returns a promise, we can handle it
                        if (onClick instanceof Promise) {
                            setLoading(true);
                            onClick
                                .catch((error) => {
                                    console.error("Error executing action", action.key, error);
                                    snackbarController.open({
                                        message: `Error executing action: ${error.message}`,
                                        type: "error"
                                    })
                                })
                                .finally(() => setLoading(false));
                        } else {
                            snackbarController.open({
                                message: `Action ${action.name} executed successfully`,
                                type: "success"
                            });
                        }

                    }
                } catch (e: unknown) {
                    console.error("Error executing action", action.key, e);
                    snackbarController.open({
                        message: `Error executing action: ${e instanceof Error ? e.message : String(e)}`,
                        type: "error"
                    });
                }
            }}>
            {loading ? <CircularProgress size={"smallest"}/> : action.icon}
        </IconButton>
    </Tooltip>;
}
