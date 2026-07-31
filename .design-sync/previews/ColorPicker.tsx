import React from "react";
import { ColorPicker } from "@rebasepro/ui";

// Real props read from packages/ui/src/components/ColorPicker.tsx (the
// emitted .d.ts leaves ChipColorKey unresolved):
//   value?: string; onChange: (colorKey: string | undefined) => void;
//   size?: "small" | "medium"; allowClear?: boolean; disabled?: boolean;
export const SelectedAndAuto = () => (
    <div className="flex gap-8 p-4">
        <div>
            <div className="text-xs font-mono text-surface-500 mb-2">selected = &quot;violet&quot;</div>
            <ColorPicker value="violet" onChange={() => {}}/>
        </div>
        <div>
            <div className="text-xs font-mono text-surface-500 mb-2">auto (no selection)</div>
            <ColorPicker value={undefined} onChange={() => {}}/>
        </div>
    </div>
);

export const Sizes = () => (
    <div className="flex flex-col gap-4 p-4">
        <div>
            <div className="text-xs font-mono text-surface-500 mb-2">size=&quot;small&quot;</div>
            <ColorPicker size="small" value="teal" onChange={() => {}}/>
        </div>
        <div>
            <div className="text-xs font-mono text-surface-500 mb-2">size=&quot;medium&quot;</div>
            <ColorPicker size="medium" value="teal" onChange={() => {}}/>
        </div>
    </div>
);

export const Disabled = () => (
    <div className="p-4">
        <ColorPicker value="rose" onChange={() => {}} disabled/>
    </div>
);
