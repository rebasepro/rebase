import React from "react";
import { InputLabel } from "@rebasepro/ui";

// InputLabel is a headless floating label — TextField/DateTimeField position
// it absolutely inside a relatively-positioned field box and toggle `shrink`
// on focus/value. Reproduce that composition since InputLabel alone (a bare
// <label>) does not demonstrate its purpose.
export const FloatingStates = () => (
    <div className="flex gap-6 p-4">
        <div className="relative rounded-lg bg-surface-accent-200/50 dark:bg-white/[0.055] min-h-[44px] w-[180px]">
            <InputLabel shrink className="absolute top-1 text-text-secondary dark:text-text-secondary-dark">
                Shrink (focused)
            </InputLabel>
        </div>
        <div className="relative rounded-lg bg-surface-accent-200/50 dark:bg-white/[0.055] min-h-[44px] w-[180px]">
            <InputLabel className="absolute text-text-secondary dark:text-text-secondary-dark">
                Expanded (empty)
            </InputLabel>
        </div>
    </div>
);

export const AsFieldLabel = () => (
    <div className="relative rounded-lg bg-surface-accent-200/50 dark:bg-white/[0.055] min-h-[44px] w-[280px] m-4">
        <InputLabel shrink className="absolute top-1 text-primary">
            Collection name
        </InputLabel>
        <div className="pt-8 pb-2 px-3 text-base">products</div>
    </div>
);
