import React from "react";
import { MultiSelect, MultiSelectItem } from "@rebasepro/ui";

// MultiSelectItem renders inside a MultiSelect's content surface — the parent
// composition is the only true render.
export const InMultiSelect = () => (
    <div className="w-[300px] p-4">
        <MultiSelect label="Roles" useChips value={["admin", "viewer"]} onValueChange={() => {}}>
            <MultiSelectItem value="admin">Admin</MultiSelectItem>
            <MultiSelectItem value="editor">Editor</MultiSelectItem>
            <MultiSelectItem value="viewer">Viewer</MultiSelectItem>
        </MultiSelect>
    </div>
);
