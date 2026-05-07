import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import React, { useState } from "react";

export interface ConfirmationDialogProps {
    title?: string;
    confirmMessage: string;
    onAccept: () => void;
}

export const useConfirmationDialog = ({
                                          title = "Confirm",
                                          confirmMessage,
                                          onAccept
                                      }: ConfirmationDialogProps) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const open = () => {
        setIsDialogOpen(true);
    }

    const ConfirmationDialog = <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => !open ? setIsDialogOpen(false) : undefined}
        containerClassName={"z-50"}
    >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
            {confirmMessage}
        </DialogContent>

        <DialogActions>
            <Button
                variant={"text"} color={"neutral"}
                onClick={() => setIsDialogOpen(false)}
                autoFocus>
                Cancel
            </Button>

            <Button
                color="primary"
                type="submit"
                onClick={() => {
                    onAccept();
                    setIsDialogOpen(false);
                }}>
                Ok
            </Button>
        </DialogActions>
    </Dialog>

    return {
        open,
        isDialogOpen,
        ConfirmationDialog
    };
};
