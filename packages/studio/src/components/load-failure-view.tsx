import React from "react";
import { ErrorView } from "@rebasepro/app";
import { Typography } from "@rebasepro/ui";

import type { LoadFailure } from "./load-failure";

export interface LoadFailureViewProps {
    failure: LoadFailure;
    /** What could not be read, for the failure case: "Could not read backups". */
    title: string;
    /** What was refused, for the denied case: "You cannot list backups". */
    deniedTitle: string;
    /** One sentence on what decides it, and what to do. */
    deniedHint: React.ReactNode;
    onRetry?: () => void;
}

/**
 * The two failures, told apart. Sized to drop into the place a pane would
 * otherwise render its empty state.
 */
export function LoadFailureView({ failure, title, deniedTitle, deniedHint, onRetry }: LoadFailureViewProps) {
    if (failure.kind === "denied") {
        return (
            <div className="flex items-center justify-center h-full p-6 overflow-auto">
                <div className="max-w-md text-center">
                    <Typography variant="subtitle2" className="block">
                        {deniedTitle}
                    </Typography>
                    <Typography variant="body2" color="secondary" className="block mt-2">
                        {deniedHint}
                    </Typography>
                    <Typography variant="caption" color="disabled" className="block mt-3 font-mono break-all">
                        {failure.detail}
                    </Typography>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center h-full p-6 overflow-auto">
            <ErrorView
                title={title}
                error={failure.detail}
                onRetry={failure.retryable ? onRetry : undefined}
            />
        </div>
    );
}
