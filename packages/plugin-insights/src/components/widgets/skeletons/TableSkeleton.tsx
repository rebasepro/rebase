import React from "react";
import { Skeleton } from "@rebasepro/ui";

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="w-full h-full flex flex-col opacity-30">
            {/* Table header - 48px height */}
            <div className="flex gap-4 px-4 h-12 items-center border-b border-surface-200 dark:border-surface-700">
                <div className="w-24"><Skeleton height={12} /></div>
                <div className="w-32"><Skeleton height={12} /></div>
                <div className="flex-1"><Skeleton height={12} /></div>
            </div>

            {/* Table rows - each 48px height */}
            <div className="flex-1">
                {Array.from({ length: rows }).map((_, i) => (
                    <div key={i} className="flex gap-4 px-4 h-12 items-center">
                        <div className="w-24"><Skeleton height={12} /></div>
                        <div className="w-32"><Skeleton height={12} /></div>
                        <div className="flex-1"><Skeleton height={12} /></div>
                    </div>
                ))}
            </div>
        </div>
    );
}

