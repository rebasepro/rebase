import React from "react";
import { BooleanSwitch } from "@rebasepro/ui";

// Ported from UIReferenceView's "Form Inputs" section.
export const States = () => (
    <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2"><BooleanSwitch value onValueChange={() => {}}/><span>On</span></div>
        <div className="flex items-center gap-2"><BooleanSwitch value={false} onValueChange={() => {}}/><span>Off</span></div>
        <div className="flex items-center gap-2"><BooleanSwitch value disabled/><span>Disabled</span></div>
    </div>
);

export const Sizes = () => (
    <div className="flex items-center gap-4 p-4">
        {(["smallest", "small", "medium", "large"] as const).map(size => (
            <div key={size} className="flex flex-col items-center gap-1">
                <BooleanSwitch size={size} value onValueChange={() => {}}/>
                <span className="text-xs text-surface-500 font-mono">{size}</span>
            </div>
        ))}
    </div>
);
