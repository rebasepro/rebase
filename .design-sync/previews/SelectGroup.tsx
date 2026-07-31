import React from "react";
import { Select, SelectItem, SelectGroup } from "@rebasepro/ui";

// SelectGroup only renders inside an open Select's content surface — full
// parent composition, controlled `open` (SelectProps has no `defaultOpen`).
export const TwoGroups = () => (
    <div className="w-[280px] p-4 h-[360px]">
        <Select open label="Category" value="bug" onValueChange={() => {}} onOpenChange={() => {}}>
            <SelectGroup label="Type">
                <SelectItem value="bug">Bug</SelectItem>
                <SelectItem value="feature">Feature</SelectItem>
            </SelectGroup>
            <SelectGroup label="Priority">
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="high">High</SelectItem>
            </SelectGroup>
        </Select>
    </div>
);

export const GroupedWithUngrouped = () => (
    <div className="w-[280px] p-4 h-[360px]">
        <Select open label="Assignee" value="unassigned" onValueChange={() => {}} onOpenChange={() => {}}>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            <SelectGroup label="Team">
                <SelectItem value="alice">Alice</SelectItem>
                <SelectItem value="bob">Bob</SelectItem>
            </SelectGroup>
        </Select>
    </div>
);
