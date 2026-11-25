import React from "react";
import { ErrorView, useTranslation } from "@rebasepro/app";
import { cls, Typography } from "@rebasepro/ui";

import { isBareNotFound, type LoadFailure } from "./load-failure";

export interface LoadFailureViewProps {
    failure: LoadFailure;
    /** What could not be read, for the failure case: "Could not read backups". */
    title: string;
    /** What was refused, for the denied case: "You cannot list backups". */
    deniedTitle: string;
    /** One sentence on what decides it, and what to do. */
    deniedHint: React.ReactNode;
    /** One sentence on what went wrong, for the failure case, above the server's own words. */
    hint?: React.ReactNode;
    /** The title when the server does not offer the tool. Defaults to a generic "Not available on this server". */
    notOfferedTitle?: string;
    /** One sentence on why, when the server does not offer the tool. Defaults to a generic one. */
    notOfferedHint?: React.ReactNode;
    onRetry?: () => void;
    /** Classes for the outer box, for a parent that sizes it as a flex item rather than by height. */
    className?: string;
}

/**
 * The three failures, told apart. Sized to drop into the place a pane would
 * otherwise render its empty state.
 */
export function LoadFailureView({
    failure,
    title,
    deniedTitle,
    deniedHint,
    hint,
    notOfferedTitle,
    notOfferedHint,
    onRetry,
    className
}: LoadFailureViewProps) {
    const { t } = useTranslation();
    const boxClass = cls("flex items-center justify-center h-full p-6 overflow-auto", className);

    if (failure.kind === "denied" || failure.kind === "not_offered") {
        const notOffered = failure.kind === "not_offered";
        // "Not found" under "Not available on this server" says nothing twice.
        const showDetail = failure.detail.trim() !== "" && !(notOffered && isBareNotFound(failure.detail));
        return (
            <div className={boxClass}>
                <div className="max-w-md text-center">
                    <Typography variant="subtitle2" className="block">
                        {notOffered ? (notOfferedTitle ?? t("studio_tool_not_offered_title")) : deniedTitle}
                    </Typography>
                    <Typography variant="body2" color="secondary" className="block mt-2">
                        {notOffered ? (notOfferedHint ?? t("studio_tool_not_offered_hint")) : deniedHint}
                    </Typography>
                    {showDetail && (
                        <Typography variant="caption" color="disabled" className="block mt-3 font-mono break-all">
                            {failure.detail}
                        </Typography>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={boxClass}>
            <ErrorView
                title={title}
                error={hint
                    ? (
                        <>
                            <Typography component="span" variant="body2" color="secondary" className="block">
                                {hint}
                            </Typography>
                            {failure.detail && (
                                <Typography component="span" variant="caption" color="disabled" className="block mt-1 font-mono break-all">
                                    {failure.detail}
                                </Typography>
                            )}
                        </>
                    )
                    : failure.detail}
                onRetry={failure.retryable ? onRetry : undefined}
            />
        </div>
    );
}
