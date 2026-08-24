import React from "react";
import { Select, SelectItem } from "@rebasepro/ui";

// SelectItem only renders inside a Select's content surface, so the true
// render is the parent composition with the menu open. `open` is the
// controlled prop; SelectProps has no `defaultOpen`.
export const InOpenSelect = () => (
    <div className="w-[280px] p-4 h-[300px]">
        <Select open label="Status" value="published" onValueChange={() => {}} onOpenChange={() => {}}>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="deleted" disabled>Deleted</SelectItem>
        </Select>
    </div>
);

export const Closed = () => (
    <div className="w-[280px] p-4">
        <Select label="Status" value="archived" onValueChange={() => {}}>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
        </Select>
    </div>
);
