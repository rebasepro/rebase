import React from "react";
import { CenteredView, Typography, CircularProgress } from "@rebasepro/ui";

export const CenteredMessage = () => (
    <div className="h-64 border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
        <CenteredView maxWidth="sm">
            <div className="flex flex-col items-center gap-2 text-center">
                <Typography variant="h6">No results found</Typography>
                <Typography variant="body2" color="secondary">Try adjusting your filters or search terms.</Typography>
            </div>
        </CenteredView>
    </div>
);

export const LoadingState = () => (
    <div className="h-56 border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden">
        <CenteredView maxWidth="xs">
            <div className="flex flex-col items-center gap-3">
                <CircularProgress size="medium"/>
                <Typography variant="caption" color="secondary">Loading workspace…</Typography>
            </div>
        </CenteredView>
    </div>
);
