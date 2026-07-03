import { useCustomizationController } from "@rebasepro/core";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import React from "react";

export function SnapshotCustomViewsSelectDialog({
    open,
    onClose
}: { open: boolean, onClose: (selectedViewKey?: string) => void }) {
    const {
        snapshotViews
    } = useCustomizationController();

    return <Dialog
        maxWidth={"md"}
        open={open}>
        <DialogTitle>Select custom view</DialogTitle>
        <DialogContent className={"flex flex-col gap-4"}>
            {snapshotViews?.map((view) => {
                return <Button
                    key={view.key}
                    onClick={() => onClose(view.key)}
                    fullWidth
                    variant={"text"}
                >
                    {view.name} ({view.key})
                </Button>;
            })}
            {(snapshotViews ?? []).length === 0 &&
                <Typography variant={"body2"}>
                    No custom views defined. Define your custom views in the customization settings, before using this
                    dialog.
                </Typography>
            }
        </DialogContent>
        <DialogActions>
            <Button onClick={() => onClose()}>Cancel</Button>
        </DialogActions>
    </Dialog>
}
