import React from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    MultiSelect,
    MultiSelectItem,
    Button,
    LoadingButton
} from "@rebasepro/ui";

// Dialog is a Radix portal — it renders `fixed inset-0`, so it always
// escapes a grid card regardless of the wrapper below. Needs
// cfg.overrides.Dialog = { cardMode: "single", primaryStory: "FormDialog" }.
// `open` is the only prop the .d.ts exposes (no defaultOpen) — force it true.

// Canonical layout ported from UIReferenceView's "Form Dialog" section:
// title -> grid grid-cols-12 gap-4 body -> right-aligned actions.
export const FormDialog = () => (
    <div className="p-4 h-[320px]">
        <Dialog open onOpenChange={() => {}} maxWidth="lg">
            <DialogTitle>Edit collection</DialogTitle>
            <DialogContent>
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12">
                        <TextField name="name" required value="products" onChange={() => {}} label="Collection name"/>
                    </div>
                    <div className="col-span-12">
                        <TextField name="path" value="products" onChange={() => {}} label="Database table"/>
                    </div>
                    <div className="col-span-12">
                        <MultiSelect className="w-full" label="RLS policies" value={["read_authenticated"]} onValueChange={() => {}}>
                            <MultiSelectItem value="read_authenticated">read_authenticated</MultiSelectItem>
                            <MultiSelectItem value="write_owner">write_owner</MultiSelectItem>
                            <MultiSelectItem value="admin_all">admin_all</MultiSelectItem>
                        </MultiSelect>
                    </div>
                </div>
            </DialogContent>
            <DialogActions>
                <Button variant="text">Cancel</Button>
                <LoadingButton variant="filled" loading={false}>Save changes</LoadingButton>
            </DialogActions>
        </Dialog>
    </div>
);

// Smaller destructive confirmation — sweeps maxWidth + a plain-text body.
export const ConfirmDialog = () => (
    <div className="p-4 h-[320px]">
        <Dialog open onOpenChange={() => {}} maxWidth="sm">
            <DialogTitle>Delete API key</DialogTitle>
            <DialogContent>
                Revoking <b>prod-server-key</b> immediately invalidates every request
                signed with it. This cannot be undone.
            </DialogContent>
            <DialogActions>
                <Button variant="text">Cancel</Button>
                <Button variant="filled" color="error">Delete key</Button>
            </DialogActions>
        </Dialog>
    </div>
);
