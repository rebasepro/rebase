import React from "react";
import { GitHubIcon, Typography } from "@rebasepro/ui";

const SIZES = [16, 24, 32, 48];
const COLORS: { label: string; className: string }[] = [
    { label: "default", className: "text-surface-900 dark:text-surface-50" },
    { label: "primary", className: "text-primary" },
    { label: "secondary", className: "text-surface-500" },
    { label: "error", className: "text-red-500" }
];

export function SizesAndColors() {
    return (
        <div className="flex flex-col gap-4 w-full">
            <div className="flex items-end gap-4">
                {SIZES.map(size => (
                    <div key={size} className="flex flex-col items-center gap-1">
                        <GitHubIcon size={size} className="text-surface-900 dark:text-surface-50" />
                        <Typography variant="caption" color="secondary" className="font-mono">{size}px</Typography>
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-4">
                {COLORS.map(({ label, className }) => (
                    <div key={label} className="flex flex-col items-center gap-1">
                        <GitHubIcon size={28} className={className} />
                        <Typography variant="caption" color="secondary">{label}</Typography>
                    </div>
                ))}
            </div>
        </div>
    );
}
