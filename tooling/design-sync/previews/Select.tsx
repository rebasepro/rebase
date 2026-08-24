import React from "react";
import { Select, SelectItem } from "@rebasepro/ui";

// Ported from UIReferenceView's "Form Inputs" section.
export const Basic = () => (
    <div className="w-[280px] p-4">
        <Select label="Status" value="published" onValueChange={() => {}}>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
        </Select>
    </div>
);

export const Sizes = () => (
    <div className="flex flex-col gap-3 w-[280px] p-4">
        {(["large", "medium", "small", "smallest"] as const).map(size => (
            <Select key={size} size={size} label={size} value="published" onValueChange={() => {}}>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
            </Select>
        ))}
    </div>
);

export const States = () => (
    <div className="flex flex-col gap-3 w-[280px] p-4">
        <Select label="Placeholder" placeholder="Pick a status" onValueChange={() => {}}>
            <SelectItem value="draft">Draft</SelectItem>
        </Select>
        <Select label="Error" error value="draft" onValueChange={() => {}}>
            <SelectItem value="draft">Draft</SelectItem>
        </Select>
        <Select label="Disabled" disabled value="draft" onValueChange={() => {}}>
            <SelectItem value="draft">Draft</SelectItem>
        </Select>
    </div>
);

// `open` is the controlled prop — SelectProps has no `defaultOpen`, so passing
// one silently renders the closed state.
export const Open = () => (
    <div className="w-[280px] p-4 h-[280px]">
        <Select open label="Status" value="published" onValueChange={() => {}} onOpenChange={() => {}}>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
        </Select>
    </div>
);
