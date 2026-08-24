import React from "react";
import { Checkbox } from "@rebasepro/ui";

// Ported from UIReferenceView's "Form Inputs" section.
export const States = () => (
    <div className="flex flex-col gap-3 p-4">
        <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked onCheckedChange={() => {}}/><span>Checked</span></label>
        <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={false} onCheckedChange={() => {}}/><span>Unchecked</span></label>
        <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={false} indeterminate onCheckedChange={() => {}}/><span>Indeterminate</span></label>
        <label className="flex items-center gap-2"><Checkbox checked disabled/><span>Disabled</span></label>
    </div>
);

export const Sizes = () => (
    <div className="flex items-center gap-4 p-4">
        {(["smallest", "small", "medium", "large"] as const).map(size => (
            <div key={size} className="flex flex-col items-center gap-1">
                <Checkbox size={size} checked onCheckedChange={() => {}}/>
                <span className="text-xs text-surface-500 font-mono">{size}</span>
            </div>
        ))}
    </div>
);

export const Colors = () => (
    <div className="flex items-center gap-4 p-4">
        <Checkbox color="primary" checked onCheckedChange={() => {}}/>
        <Checkbox color="secondary" checked onCheckedChange={() => {}}/>
    </div>
);
