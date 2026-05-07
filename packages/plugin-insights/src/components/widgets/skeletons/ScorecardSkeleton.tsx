import React from "react";
import { Skeleton } from "@rebasepro/ui";

export function ScorecardSkeleton() {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 opacity-30">
            <Skeleton width={120} height={40} />
            <Skeleton width={80} height={12} />
        </div>
    );
}

