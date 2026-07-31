import React from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from "@rebasepro/ui";

// DialogTitle only renders inside Dialog's Radix context (it wraps
// DialogPrimitive.Title asChild) — these previews are the full parent
// composition. Same portal-escape problem as Dialog: needs
// cfg.overrides.DialogTitle = { cardMode: "single", primaryStory: "Default" }.

// Default variant is "subtitle2" (component default) — smaller, dense title
// used for compact dialogs (e.g. row-action confirmations).
export const Default = () => (
    <div className="p-4 h-[280px]">
        <Dialog open onOpenChange={() => {}} maxWidth="sm">
            <DialogTitle>Regenerate API key</DialogTitle>
            <DialogContent>
                A new secret will be issued. The old one keeps working for 24h.
            </DialogContent>
            <DialogActions>
                <Button variant="text">Cancel</Button>
                <Button variant="filled">Regenerate</Button>
            </DialogActions>
        </Dialog>
    </div>
);

// Larger heading variant — sweeps the `variant` prop for dialogs that need
// more visual weight (e.g. a primary settings screen).
export const LargeHeading = () => (
    <div className="p-4 h-[280px]">
        <Dialog open onOpenChange={() => {}} maxWidth="md">
            <DialogTitle variant="h4">Project settings</DialogTitle>
            <DialogContent>
                Manage database connection, storage sources and deploy hooks for this project.
            </DialogContent>
        </Dialog>
    </div>
);
