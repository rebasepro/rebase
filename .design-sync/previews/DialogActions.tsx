import React from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, LoadingButton } from "@rebasepro/ui";

// DialogActions is the sticky/absolute footer bar of a Dialog — only
// renders meaningfully inside one. Same portal-escape issue as Dialog.
// Needs cfg.overrides.DialogActions = { cardMode: "single", primaryStory: "Default" }.

export const Default = () => (
    <div className="p-4 h-[280px]">
        <Dialog open onOpenChange={() => {}} maxWidth="sm">
            <DialogTitle>Create API key</DialogTitle>
            <DialogContent>Choose a name and scope for the new key.</DialogContent>
            <DialogActions>
                <Button variant="text">Cancel</Button>
                <LoadingButton variant="filled" loading={false}>Create key</LoadingButton>
            </DialogActions>
        </Dialog>
    </div>
);

// Non-translucent variant with a destructive action — sweeps `translucent`.
// (position="absolute" takes the bar out of flow and overlaps the content
// above it — that's the real component's own layout, not something a
// static preview with short body text can show cleanly, so this sticks
// with the default "sticky" position.)
export const Destructive = () => (
    <div className="p-4 h-[280px]">
        <Dialog open onOpenChange={() => {}} maxWidth="sm">
            <DialogTitle>Drop table &quot;sessions&quot;</DialogTitle>
            <DialogContent>This permanently deletes the table and all rows in it.</DialogContent>
            <DialogActions translucent={false}>
                <Button variant="text">Cancel</Button>
                <Button variant="filled" color="error">Drop table</Button>
            </DialogActions>
        </Dialog>
    </div>
);
