import React from "react";
import { Skeleton } from "@rebasepro/ui";

export const RowLoading = () => (
    <div className="flex items-center gap-4 p-4">
        <Skeleton className="w-10 h-10 rounded-full"/>
        <div className="flex flex-col gap-2">
            <Skeleton className="w-48 h-4 rounded"/>
            <Skeleton className="w-32 h-3 rounded"/>
        </div>
    </div>
);

export const CardLoading = () => (
    <div className="p-4 w-64 flex flex-col gap-3 border border-surface-200 dark:border-surface-700 rounded-lg">
        <Skeleton height={80} className="rounded-md"/>
        <Skeleton width={160} height={14} className="rounded"/>
        <Skeleton width={100} height={12} className="rounded"/>
    </div>
);
