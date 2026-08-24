import React from "react";
import { Select, SelectItem, SelectInputLabel } from "@rebasepro/ui";

// SelectInputLabel only renders inside Select/MultiSelect's label slot — full
// parent composition. Select renders `label` verbatim (bypassing its own
// SelectInputLabel wrapper) whenever it's passed a ReactNode instead of a
// string, so this is the real render path, not a lookalike.
export const Default = () => (
    <div className="w-[280px] p-4">
        <Select
            label={<SelectInputLabel>Assigned role</SelectInputLabel>}
            value="editor"
            onValueChange={() => {}}
        >
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
        </Select>
    </div>
);

export const ErrorState = () => (
    <div className="w-[280px] p-4">
        <Select
            label={<SelectInputLabel error>Assigned role</SelectInputLabel>}
            error
            value=""
            onValueChange={() => {}}
        >
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
        </Select>
    </div>
);
