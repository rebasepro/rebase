
import { useUnsavedChangesDialog, UnsavedChangesDialog } from "@rebasepro/app";
import * as React from "react";
import { useState } from "react";
import { Button, PlusIcon, Typography } from "@rebasepro/ui";
import { CollectionEditorDialogProps } from "./CollectionEditorDialog";
import { AIModifiedPathsProvider } from "./AIModifiedPathsContext";
import { CollectionEditor } from "./CollectionEditorDialog";
import type { AdminCollection } from "@rebasepro/cms-types";

export type CollectionStudioViewProps = Omit<CollectionEditorDialogProps, "open" | "isNewCollection" | "editedCollectionId" | "handleClose" | "handleCancel"> & {
    collectionId?: string | "new";

    /**
     * Called after a successful save.
     * Receives the saved collection (or undefined if dismissed without saving).
     * When not provided, save completes silently.
     */
    onSave?: (collection?: AdminCollection) => void;

    /**
     * Called when the user cancels editing.
     * When not provided, cancel is a no-op.
     */
    onCancel?: () => void;
};

export function CollectionStudioView({ collectionId, onSave, onCancel, ...props }: CollectionStudioViewProps) {

    // Form state from the editor
    const [formDirty, setFormDirty] = useState<boolean>(false);
    const [cancelRequested, setCancelRequested] = useState<boolean>(false);

    const { dialogProps, triggerDialog } = useUnsavedChangesDialog(
        formDirty,
        () => setFormDirty(false)
    );

    const activeCollectionId = collectionId;

    const handleCancelClick = () => {
        if (!formDirty) {
            onCancel?.();
        } else {
            setCancelRequested(true);
            triggerDialog();
        }
    };

    return (
        <div className="flex-grow flex flex-col h-full w-full bg-surface-50 dark:bg-surface-800">
            <AIModifiedPathsProvider>
                {activeCollectionId ? (
                    <CollectionEditor
                        key={activeCollectionId}
                        {...props}
                        fullScreen={true}
                        open={true}
                        isNewCollection={activeCollectionId === "new"}
                        editedCollectionId={activeCollectionId !== "new" ? activeCollectionId : undefined}
                        handleCancel={handleCancelClick}
                        handleClose={(savedCollection) => {
                            setFormDirty(false);
                            if (savedCollection) {
                                setTimeout(() => {
                                    onSave?.(savedCollection);
                                }, 0);
                            }
                        }}
                        setFormDirty={setFormDirty}
                    />
                ) : (
                    <div className="flex-grow flex flex-col items-center justify-center h-full gap-4">
                        <Typography variant="label">
                            Select a collection or create a new one
                        </Typography>
                        <Button
                            disabled={props.configController?.readOnly}
                            onClick={() => onSave?.()}
                        >
                            <PlusIcon/>
                            Add new collection
                        </Button>
                    </div>
                )}

                <UnsavedChangesDialog
                    {...dialogProps}
                    handleOk={() => {
                        dialogProps.handleOk();
                        if (cancelRequested) {
                            onCancel?.();
                            setCancelRequested(false);
                        }
                    }}
                    handleCancel={() => {
                        dialogProps.handleCancel();
                        setCancelRequested(false);
                    }}
                />
            </AIModifiedPathsProvider>
        </div>
    );
}
