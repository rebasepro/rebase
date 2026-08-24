import React from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Typography, Button } from "@rebasepro/ui";

// DialogContent only makes sense inside an open Dialog — full parent
// composition, same portal-escape issue. Needs cfg.overrides.DialogContent
// = { cardMode: "single", primaryStory: "Default" }.

export const Default = () => (
    <div className="p-4 h-[320px]">
        <Dialog open onOpenChange={() => {}} maxWidth="md">
            <DialogTitle>Rotate encryption key</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="secondary">
                    Rotating the cluster encryption key re-wraps every secret in the
                    project. Existing deploys keep running; new ones use the new key.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button variant="text">Cancel</Button>
                <Button variant="filled">Rotate key</Button>
            </DialogActions>
        </Dialog>
    </div>
);

// Longer body content, scrollable dialog — shows DialogContent's default
// `my-8 mx-8` margin against a list of policy rows.
export const ScrollableBody = () => (
    <div className="p-4 h-[320px]">
        <Dialog open onOpenChange={() => {}} maxWidth="md" scrollable fullHeight>
            <DialogTitle>Row-level security policies</DialogTitle>
            <DialogContent>
                <div className="flex flex-col gap-3">
                    {[
                        { name: "select_authenticated", table: "orders", op: "SELECT" },
                        { name: "insert_owner", table: "orders", op: "INSERT" },
                        { name: "update_owner", table: "orders", op: "UPDATE" },
                        { name: "delete_admin", table: "orders", op: "DELETE" }
                    ].map(p => (
                        <div key={p.name} className="flex items-center justify-between border-b border-surface-200 dark:border-surface-800 pb-2">
                            <Typography variant="body2" className="font-mono">{p.name}</Typography>
                            <Typography variant="caption" color="secondary">{p.table} · {p.op}</Typography>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    </div>
);
