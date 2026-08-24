import React from "react";
import { CircularProgress, Typography } from "@rebasepro/ui";

export const Sizes = () => (
    <div className="flex gap-6 items-end p-4">
        {(["smallest", "small", "medium", "large"] as const).map(s => (
            <div key={s} className="flex flex-col items-center gap-1">
                <CircularProgress size={s}/>
                <Typography variant="caption" color="secondary">{s}</Typography>
            </div>
        ))}
    </div>
);

export const InButton = () => (
    <div className="p-4">
        <button
            disabled
            className="inline-flex items-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-4 py-2 text-sm font-medium text-text-secondary dark:text-text-secondary-dark opacity-80"
        >
            <CircularProgress size="smallest"/>
            Saving…
        </button>
    </div>
);
