
import { type SnapshotCollection, getCollectionDataPath } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import type { SnapshotAction } from "@rebasepro/types";
import React from "react";
import { Snapshot } from "@rebasepro/types";
import type { SnapshotFormActionsProps } from "../types/components/SnapshotFormActionsProps";
import {
    AlertCircleIcon,
    Button,
    cls,
    defaultBorderMixin,
    DialogActions,
    IconButton,
    LoadingButton,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { FormexController } from "@rebasepro/formex";

export function SnapshotFormActions({
    path,
    collection,
    snapshot,
    layout,
    savingError,
    formex,
    disabled,
    status,
    pluginActions,
    openSnapshotMode,
    navigateBack,
    formContext
}: SnapshotFormActionsProps) {

    const bottomActionsProps = {
        path,
        savingError,
        snapshot,
        collection,
        disabled,
        status,
        pluginActions,
        openSnapshotMode,
        navigateBack,
        formContext,
        formex,
        className: layout === "responsive" ? "@6xl:hidden" : undefined
    };

    const sideActionsProps = {
        path,
        savingError,
        snapshot,
        collection,
        disabled,
        status,
        pluginActions,
        openSnapshotMode,
        navigateBack,
        formContext,
        formex,
        className: layout === "responsive" ? "hidden @6xl:flex" : undefined
    };

    const bottomActions = buildBottomActions(bottomActionsProps);
    const sideActions = buildSideActions(sideActionsProps);

    if (layout === "responsive") {
        return <>
            {bottomActions}
            {sideActions}
        </>;
    }

    return layout === "bottom" ? bottomActions : sideActions;
}

type ActionsViewProps<M extends Record<string, unknown>> = {
    path: string,
    savingError: Error | undefined,
    snapshot: Snapshot<M> | undefined,
    formActions?: SnapshotAction[],
    collection: SnapshotCollection,
    disabled: boolean,
    status: "new" | "existing" | "copy",
    pluginActions?: React.ReactNode[],
    openSnapshotMode?: "side_panel" | "full_screen" | "split" | "dialog";
    navigateBack: () => void;
    formContext: FormContext,
    formex: FormexController<Record<string, unknown>>;
    className?: string;
};

function buildBottomActions<M extends Record<string, unknown>>({
    savingError,
    snapshot,
    path,
    formActions,
    collection,
    disabled,
    status,
    pluginActions,
    openSnapshotMode,
    navigateBack,
    formContext,
    formex,
    className
}: ActionsViewProps<M>) {

    const hasErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;

    return <DialogActions position={"absolute"} className={className}>
        {savingError &&
            <div className="text-right">
                <Typography color={"error"}>{savingError.message}</Typography>
            </div>
        }
        {snapshot && (formActions ?? []).length > 0 && <div className="grow flex overflow-auto no-scrollbar">
            {(formActions ?? []).map(action => (
                <IconButton
                    key={action.name}
                    color="primary"
                    onClick={(event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
                        event.stopPropagation();
                        if (snapshot)
                            action.onClick({
                                view: "form",
                                snapshot,
                                path: path ?? getCollectionDataPath(collection),
                                collection: collection,
                                context: undefined,
                                sideSnapshotController: undefined,
                                openSnapshotMode: openSnapshotMode,
                                navigateBack,
                                formContext
                            });
                    }}>
                    {action.icon}
                </IconButton>
            ))}
        </div>}
        {pluginActions}
        <Button variant="text" disabled={disabled || formex.isSubmitting}
            color={"primary"}
            type="reset">
            {status === "existing" ? "Discard" : "Clear"}
        </Button>
        <Tooltip title={hasErrors ? "Fix highlighted errors before saving" : undefined}>
            <LoadingButton variant={"filled"}
                color="primary"
                type="submit"
                loading={formex.isSubmitting}
                disabled={disabled || formex.isSubmitting}
                startIcon={hasErrors ? <AlertCircleIcon/> : undefined}>
                {status === "existing" && "Save"}
                {status === "copy" && "Create copy"}
                {status === "new" && "Create"}
            </LoadingButton>
        </Tooltip>

    </DialogActions>;
}

function buildSideActions<M extends Record<string, unknown>>({
    savingError,
    snapshot,
    formActions,
    path,
    openSnapshotMode,
    collection,
    disabled,
    status,
    pluginActions,
    formex,
    className
}: ActionsViewProps<M>) {

    const hasErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;

    return <div
        className={cls("overflow-auto h-full flex flex-col gap-2 w-80 2xl:w-96 px-4 py-16 sticky top-0 border-l", defaultBorderMixin, className)}>
        <Tooltip title={hasErrors ? "Fix highlighted errors before saving" : undefined}>
            <LoadingButton fullWidth={true}
                variant="filled"
                color="primary"
                type="submit"
                loading={formex.isSubmitting}
                startIcon={hasErrors ? <AlertCircleIcon/> : undefined}
                disabled={disabled || formex.isSubmitting}>
                {status === "existing" && "Save"}
                {status === "copy" && "Create copy"}
                {status === "new" && "Create"}
            </LoadingButton>
        </Tooltip>
        <Button fullWidth={true} variant="text" disabled={disabled || formex.isSubmitting} type="reset">
            {status === "existing" ? "Discard" : "Clear"}
        </Button>

        {pluginActions}

        {savingError &&
            <div className="text-right">
                <Typography color={"error"}>{savingError.message}</Typography>
            </div>
        }
    </div>;
}
