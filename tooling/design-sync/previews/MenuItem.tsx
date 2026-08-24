import React from "react";
import { Menu, MenuItem, IconButton, MoreVerticalIcon, CopyIcon, Trash2Icon, KeyRoundIcon, SettingsIcon } from "@rebasepro/ui";

// MenuItem only renders inside Menu's dropdown-menu portal — full parent
// composition below, forced open via Menu's `defaultOpen` (Menu, unlike
// Select/Popover, does expose it). Content escapes the grid card the same
// way Menu's own preview does — needs cfg.overrides.MenuItem =
// { cardMode: "single", primaryStory: "Default" }.

export const Default = () => (
    <div className="p-4 h-[280px]">
        <Menu defaultOpen align="start" trigger={<IconButton size="small" aria-label="Row actions"><MoreVerticalIcon size={16}/></IconButton>}>
            <MenuItem><KeyRoundIcon size={16}/> Rotate key</MenuItem>
            <MenuItem><CopyIcon size={16}/> Copy ID</MenuItem>
            <MenuItem disabled><Trash2Icon size={16}/> Revoke (owner only)</MenuItem>
        </Menu>
    </div>
);

// Dense variant — compact rows for tight contexts like a table row menu.
export const Dense = () => (
    <div className="p-4 h-[260px]">
        <Menu defaultOpen align="start" trigger={<IconButton size="small" aria-label="Settings"><SettingsIcon size={16}/></IconButton>}>
            <MenuItem dense>Rename</MenuItem>
            <MenuItem dense>Duplicate</MenuItem>
            <MenuItem dense>Move to…</MenuItem>
        </Menu>
    </div>
);
