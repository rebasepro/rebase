import React from "react";
import { Sheet, Typography, TextField, MultiSelect, MultiSelectItem, Button, LoadingButton, IconButton, XIcon, Checkbox } from "@rebasepro/ui";

// Sheet's `open` prop is required (not optional) — always pass it. It has
// no visible header of its own (only a sr-only DialogPrimitive.Title), so
// any header chrome is composed by the caller, as below. Content is a fixed
// Radix Dialog portal (`fixed … right-0/left-0`), so it escapes the grid
// card — needs cfg.overrides.Sheet = { cardMode: "single", primaryStory: "RightPanel" }.

export const RightPanel = () => (
    <div className="p-4 h-[320px]">
        <Sheet open onOpenChange={() => {}} side="right" title="Edit user">
            <div className="w-96 h-full flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-800">
                    <Typography variant="h5">Edit user</Typography>
                    <IconButton size="small" aria-label="Close"><XIcon size={16}/></IconButton>
                </div>
                <div className="flex-grow p-6 flex flex-col gap-4 overflow-y-auto">
                    <TextField label="Name" value="Alice Johnson" onChange={() => {}}/>
                    <TextField label="Email" value="alice@example.com" onChange={() => {}}/>
                    <MultiSelect label="Roles" value={["admin"]} onValueChange={() => {}}>
                        <MultiSelectItem value="admin">Admin</MultiSelectItem>
                        <MultiSelectItem value="editor">Editor</MultiSelectItem>
                    </MultiSelect>
                </div>
                <div className="px-6 py-4 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-2">
                    <Button variant="text">Cancel</Button>
                    <LoadingButton variant="filled" loading={false}>Save</LoadingButton>
                </div>
            </div>
        </Sheet>
    </div>
);

// Left-side navigation panel — sweeps the `side` prop.
export const LeftPanel = () => (
    <div className="p-4 h-[320px]">
        <Sheet open onOpenChange={() => {}} side="left" title="Filter collections">
            <div className="w-72 h-full flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 dark:border-surface-800">
                    <Typography variant="h5">Filters</Typography>
                    <IconButton size="small" aria-label="Close"><XIcon size={16}/></IconButton>
                </div>
                <div className="flex-grow p-5 flex flex-col gap-3">
                    {["Has RLS enabled", "Auth collection", "Realtime enabled"].map((label, i) => (
                        <label key={label} className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox checked={i === 0} onCheckedChange={() => {}}/>
                            {label}
                        </label>
                    ))}
                </div>
            </div>
        </Sheet>
    </div>
);
