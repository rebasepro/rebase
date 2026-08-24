import React from "react";
import { Tooltip, IconButton, Button, KeyIcon, Trash2Icon } from "@rebasepro/ui";

// Tooltip supports both `open` and `defaultOpen` per the .d.ts — use the
// controlled `open` (+ no-op onOpenChange) to force the visible state, same
// as Popover/Select. Content renders through a Radix portal, so it escapes
// the grid card — needs cfg.overrides.Tooltip = { cardMode: "single", primaryStory: "Default" }.

export const Default = () => (
    <div className="p-4 h-[280px] flex items-center justify-center">
        <Tooltip open onOpenChange={() => {}} title="Copy connection string" side="top">
            <IconButton size="small" aria-label="Copy"><KeyIcon size={16}/></IconButton>
        </Tooltip>
    </div>
);

// Destructive-action tooltip on a text button, sweeping `side="right"`.
export const OnButton = () => (
    <div className="p-4 h-[280px] flex items-center justify-center">
        <Tooltip open onOpenChange={() => {}} title="Requires owner role" side="right">
            <Button variant="outlined" color="error" startIcon={<Trash2Icon size={16}/>} disabled>
                Delete project
            </Button>
        </Tooltip>
    </div>
);
