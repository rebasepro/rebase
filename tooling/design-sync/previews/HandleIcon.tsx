import React from "react";
import { HandleIcon, Typography } from "@rebasepro/ui";

// The DS's own drag-handle icon. Takes IconProps like GitHubIcon does:
// `size` is a number or an iconSize keyword, plus color/className/style/onClick.
const SIZES = ["smallest", "small", "medium", "large"] as const;
const COLORS = ["inherit", "primary", "secondary", "disabled", "error"] as const;

export function Sizes() {
    return (
        <div className="flex items-end gap-4 p-4">
            {SIZES.map(size => (
                <div key={size} className="flex flex-col items-center gap-1">
                    <HandleIcon size={size}/>
                    <Typography variant="caption" color="secondary" className="font-mono">{size}</Typography>
                </div>
            ))}
            <div className="flex flex-col items-center gap-1">
                <HandleIcon size={40}/>
                <Typography variant="caption" color="secondary" className="font-mono">40</Typography>
            </div>
        </div>
    );
}

export function Colors() {
    return (
        <div className="flex items-center gap-4 p-4">
            {COLORS.map(color => (
                <div key={color} className="flex flex-col items-center gap-1">
                    <HandleIcon color={color}/>
                    <Typography variant="caption" color="secondary">{color}</Typography>
                </div>
            ))}
        </div>
    );
}

// Where it actually gets used: the drag affordance on a reorderable row.
export function InRow() {
    return (
        <div className="w-[320px] p-4 flex flex-col gap-1">
            {["Website Redesign", "API Rate Limiting", "Dark Mode Polish"].map(name => (
                <div key={name}
                     className="flex items-center gap-3 px-3 py-2 rounded-md border border-surface-200 dark:border-surface-700">
                    <HandleIcon size="smallest" color="disabled"/>
                    <span className="text-sm">{name}</span>
                </div>
            ))}
        </div>
    );
}
