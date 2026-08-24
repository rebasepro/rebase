import React from "react";
import { ErrorBoundary, Typography } from "@rebasepro/ui";

function Boom(): React.ReactElement {
    throw new Error("Failed to load dashboard widgets");
}

export const HealthyChild = () => (
    <div className="p-4 w-80 border border-surface-200 dark:border-surface-700 rounded-lg">
        <ErrorBoundary>
            <Typography variant="body2">Dashboard content renders normally — the boundary is invisible until a child throws.</Typography>
        </ErrorBoundary>
    </div>
);

export const InlineError = () => (
    <div className="p-4 w-80 border border-surface-200 dark:border-surface-700 rounded-lg">
        <ErrorBoundary>
            <Boom/>
        </ErrorBoundary>
    </div>
);

export const FullPageError = () => (
    <div className="h-[440px] w-full border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
        <ErrorBoundary fullPage>
            <Boom/>
        </ErrorBoundary>
    </div>
);
