import React from "react";
import {
    Avatar,
    Menu,
    MenuItem,
    IconButton,
    Typography,
    MoonIcon,
    SunIcon,
    SunMoonIcon,
    SettingsIcon,
    LogOutIcon,
    MoreVerticalIcon
} from "@rebasepro/ui";

// Open by default so the card shows the menu surface rather than a bare
// trigger. Ported from UIReferenceView's App Bar section (DefaultAppBar).
export const AccountMenu = () => (
    <div className="p-4 h-[320px]">
        <Menu defaultOpen align="start" trigger={<Avatar>A</Avatar>}>
            <div className="px-4 py-2 mb-2">
                <Typography variant="body1" color="secondary">Alice Johnson</Typography>
                <Typography variant="body2" color="secondary">alice@example.com</Typography>
            </div>
            <MenuItem><SettingsIcon size={16}/> Account settings</MenuItem>
            <MenuItem><LogOutIcon size={16}/> Log out</MenuItem>
        </Menu>
    </div>
);

export const ThemeMenu = () => (
    <div className="p-4 h-[260px]">
        <Menu defaultOpen align="start" trigger={<IconButton color="inherit"><MoonIcon/></IconButton>}>
            <MenuItem><MoonIcon size={16}/> Dark</MenuItem>
            <MenuItem><SunIcon size={16}/> Light</MenuItem>
            <MenuItem><SunMoonIcon size={16}/> System</MenuItem>
        </Menu>
    </div>
);

export const RowActions = () => (
    <div className="p-4 h-[260px]">
        <Menu defaultOpen align="start" trigger={<IconButton size="small"><MoreVerticalIcon/></IconButton>}>
            <MenuItem>Edit</MenuItem>
            <MenuItem>Duplicate</MenuItem>
            <MenuItem>Copy ID</MenuItem>
        </Menu>
    </div>
);

// Closed state — what the trigger looks like inline, before interaction.
export const Trigger = () => (
    <div className="flex items-center gap-4 p-4">
        <Menu trigger={<Avatar>A</Avatar>}><MenuItem>Log out</MenuItem></Menu>
        <Menu trigger={<IconButton size="small"><MoreVerticalIcon/></IconButton>}><MenuItem>Edit</MenuItem></Menu>
    </div>
);
