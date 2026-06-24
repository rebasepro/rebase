import React from "react";
import { ErrorTooltip } from "./ErrorTooltip";
import { AlertTriangleIcon, Button, Typography, iconSize } from "@rebasepro/ui";

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
        <div className="flex flex-col m-2">
            <div className="flex items-start gap-2.5">
                <AlertTriangleIcon
                    size={iconSize.smallest}
                    className="shrink-0 text-red-500 dark:text-red-400 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                    {title && (
                        <Typography
                            variant="body2"
                            color="primary"
                            className="font-semibold mb-0.5"
                        >
                            {title}
                        </Typography>
                    )}
                    <Typography
                        variant="body2"
                        color="secondary"
                        className="leading-relaxed"
                    >
                        {message}
                    </Typography>
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
                                variant="outlined"
                                color="neutral"
                                size="small"
                                onClick={onRetry}
                                className="font-semibold"
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
