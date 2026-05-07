import React from "react";
import { DatabaseConnectionConfig } from "../../types";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, LoadingButton, Typography } from "@rebasepro/ui";

export interface DeleteDbConnectionDialogProps {
    showDeleteConfirm: DatabaseConnectionConfig | null;
    setShowDeleteConfirm: (connection: DatabaseConnectionConfig | null) => void;
    deletingId: string | null;
    onDeleteConfirm: () => Promise<void>;
}

export function DeleteDbConnectionDialog({
    showDeleteConfirm,
    setShowDeleteConfirm,
    deletingId,
    onDeleteConfirm
}: DeleteDbConnectionDialogProps) {
    if (!showDeleteConfirm) return null;

    return (
        <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
            <DialogTitle>Delete Connection "{showDeleteConfirm.name}"?</DialogTitle>
            <DialogContent>
                <Typography>
                    Are you sure you want to delete this database connection? This action cannot be undone.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={() => setShowDeleteConfirm(null)} disabled={!!deletingId}>
                    Cancel
                </Button>
                <LoadingButton
                    color="error"
                    variant="filled"
                    onClick={onDeleteConfirm}
                    loading={!!deletingId}
                >
                    Delete
                </LoadingButton>
            </DialogActions>
        </Dialog>
    );
}
