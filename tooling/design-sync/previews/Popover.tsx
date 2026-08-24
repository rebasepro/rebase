import React from "react";
import { Popover, Button, IconButton, TextField, Typography, Chip, SearchIcon, KeyRoundIcon } from "@rebasepro/ui";

// Popover has no `defaultOpen` in the .d.ts, only controlled `open` — force
// it with `open` + a no-op `onOpenChange`, same pattern as Select.
// Content renders through a Radix portal and escapes the card, so this
// needs cfg.overrides.Popover = { cardMode: "single", primaryStory: "FilterPopover" }.

export const FilterPopover = () => (
    <div className="p-4 h-[320px] flex items-center justify-center">
        <Popover
            open
            onOpenChange={() => {}}
            side="bottom"
            align="start"
            trigger={<Button variant="outlined" startIcon={<SearchIcon size={16}/>}>Filter rows</Button>}
        >
            <div className="w-64 p-3 flex flex-col gap-3">
                <TextField label="Column" value="status" onChange={() => {}} size="small"/>
                <div className="flex flex-wrap gap-1.5">
                    <Chip colorScheme="green">published</Chip>
                    <Chip colorScheme="gray" outlined>draft</Chip>
                    <Chip colorScheme="gray" outlined>archived</Chip>
                </div>
            </div>
        </Popover>
    </div>
);

export const KeyDetailsPopover = () => (
    <div className="p-4 h-[320px] flex items-center justify-center">
        <Popover
            open
            onOpenChange={() => {}}
            side="right"
            align="start"
            trigger={<IconButton size="small" aria-label="Key details"><KeyRoundIcon size={16}/></IconButton>}
        >
            <div className="w-56 p-3 flex flex-col gap-1">
                <Typography variant="subtitle2">prod-server-key</Typography>
                <Typography variant="caption" color="secondary">Created Jul 12, 2026</Typography>
                <Typography variant="caption" color="secondary">Scopes: data:read, data:write</Typography>
            </div>
        </Popover>
    </div>
);
