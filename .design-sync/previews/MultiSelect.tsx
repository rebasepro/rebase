import React from "react";
import { MultiSelect, MultiSelectItem } from "@rebasepro/ui";

// Ported from UIReferenceView's "Form Inputs" and "Form Dialog" sections.
export const Basic = () => (
    <div className="w-[300px] p-4">
        <MultiSelect label="Roles" value={["admin", "editor"]} onValueChange={() => {}}>
            <MultiSelectItem value="admin">Admin</MultiSelectItem>
            <MultiSelectItem value="editor">Editor</MultiSelectItem>
            <MultiSelectItem value="viewer">Viewer</MultiSelectItem>
        </MultiSelect>
    </div>
);

export const WithChips = () => (
    <div className="w-[300px] p-4">
        <MultiSelect label="Roles" useChips value={["admin", "editor", "viewer"]} onValueChange={() => {}}>
            <MultiSelectItem value="admin">Admin</MultiSelectItem>
            <MultiSelectItem value="editor">Editor</MultiSelectItem>
            <MultiSelectItem value="viewer">Viewer</MultiSelectItem>
        </MultiSelect>
    </div>
);

export const States = () => (
    <div className="flex flex-col gap-3 w-[300px] p-4">
        <MultiSelect label="Empty" placeholder="Pick roles" value={[]} onValueChange={() => {}}>
            <MultiSelectItem value="admin">Admin</MultiSelectItem>
        </MultiSelect>
        <MultiSelect label="Error" error value={["admin"]} onValueChange={() => {}}>
            <MultiSelectItem value="admin">Admin</MultiSelectItem>
        </MultiSelect>
        <MultiSelect label="Disabled" disabled value={["admin"]} onValueChange={() => {}}>
            <MultiSelectItem value="admin">Admin</MultiSelectItem>
        </MultiSelect>
    </div>
);
