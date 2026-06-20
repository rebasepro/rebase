import React from "react";
import { ErrorTooltip } from "./ErrorTooltip";
import { AlertTriangleIcon, Button, Typography } from "@rebasepro/ui";

/**
 * @group Components
 */
export interface ErrorViewProps {
    title?: string;
    error: Error | React.ReactElement | string,
    tooltip?: string,
    onRetry?: () => void;
}

/**
 * Generic error view. Displayed for example when an unexpected value comes
 * from the driver in a collection view.
 * @param title
 * @param error
 * @param tooltip
 * @param onRetry

 * @group Components
 */
export function ErrorView({
    title,
    error,
    tooltip,
    onRetry
}: ErrorViewProps): React.ReactElement {
    const message = error instanceof Error ? error.message : error;
    // Extract error code from ApiError instances (e.g. PG error codes like "42P01")
    const errorCode = error instanceof Error && "code" in error
        ? (error as Error & { code?: string }).code
        : undefined;

    const body = (
        <div
            className="flex flex-col m-2">
            <div className="flex items-center gap-2">
                <AlertTriangleIcon className="shrink-0"/>
                <div>
                    {title && <Typography
                        variant={"body2"}
                        className="font-medium text-text-primary">{title}</Typography>}
                    <Typography variant={"body2"} className="text-text-secondary">{message}</Typography>
                    {errorCode && (
                        <span
                            className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-surface-200 dark:bg-surface-700 text-text-secondary"
                        >
                            {errorCode}
                        </span>
                    )}
                    {onRetry && (
                        <div className="mt-3">
                            <Button
                                variant="text"
                                size="small"
                                onClick={onRetry}
                                className="text-text-secondary hover:text-text-primary px-2 min-w-0"
                            >
                                Try again
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    if (tooltip) {
        return (
            <ErrorTooltip title={tooltip}>
                {body}
            </ErrorTooltip>
        );
    }
    return body;
}
