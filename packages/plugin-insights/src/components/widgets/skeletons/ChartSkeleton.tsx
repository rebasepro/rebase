import React from "react";
import { Skeleton } from "@rebasepro/ui";

export function ChartSkeleton() {
    return (
        <div className="w-full h-full flex items-end justify-center gap-4 pb-12 opacity-30">
            <Skeleton width={48} height={120} />
            <Skeleton width={48} height={180} />
            <Skeleton width={48} height={140} />
        </div>
    );
}

